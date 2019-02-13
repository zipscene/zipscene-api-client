// Copyright 2016 Zipscene, LLC
// Licensed under the Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0

const pasync = require('pasync');
const request = require('request');
const XError = require('xerror');
const _ = require('lodash');
const zstreams = require('zstreams');
const PassThrough = require('zstreams').PassThrough;
const decamelize = require('decamelize');

const DEFAULT_ROUTE_VERSION = 2;
const DEFAULT_AUTH_ROUTE_VERSION = 1;

const AUTH_METHOD_CREDENTIALS = 1;
const AUTH_METHOD_TOKEN = 2;
const AUTH_METHOD_NONE = 3;

// register API_CLIENT_ERROR XError error code
XError.registerErrorCode('api_client_error', { message: 'API Client internal or authorization error' });
XError.registerErrorCode('token_expired', { message: 'Access token has expired' });
/**
 * This class passes jsonrpc requests to a server. It will authenticate
 * with a username and password. It will refresh an accessToken
 * when it expires.
 *
 * @class ZipsceneRPCClient
 * @constructor
 * @param {Object} settings - settings object for authentication and sever set up
 *   @param {String} settings.server - the server location to make requests
 *   @param {String} settings.authServer - the server to authenticate with when different from
 *     the server to make requests on.
 *   @param {String} settings.email - The email address to authenticate with.
 *   @param {String} settings.username - Alias for 'email'
 *   @param {String} settings.password - the password to authenticate with
 *   @param {String} settings.userNamespaceId - The user namespace the authenticated user belongs to.
 *   @param {String} settings.accessToken - the accessToken to use to make requests
 *   @param {Number} settings.routeVersion - Version of RPC endpoint to use
 * @since v0.0.1
 */
class ZipsceneRPCClient {

	constructor(settings={}) {
		if (settings.username) {
			settings.email = settings.username;
		}

		this.settings = settings;
		if (!settings.server) {
			throw new XError(XError.INVALID_ARGUMENT, 'server is not configured');
		}
		this.server = settings.server;
		this.routeVersion = settings.routeVersion || DEFAULT_ROUTE_VERSION;
		if (!settings.authServer) {
			throw new XError(XError.INVALID_ARGUMENT, 'authServer is not configured');
		}
		this.authServer = settings.authServer;
		this.authRouteVersion = settings.authRouteVersion || DEFAULT_AUTH_ROUTE_VERSION;

		// Check which method of authentication this client will use
		if (settings.email && settings.password) {
			this.authMethod = AUTH_METHOD_CREDENTIALS;
			this.email = settings.email;
			this.password = settings.password;
			this.userNamespaceId = settings.userNamespaceId;
		} else if (settings.accessToken) {
			this.authMethod = AUTH_METHOD_TOKEN;
			this.originalAccessToken = settings.accessToken;
		} else if (settings.noAuth) {
			this.authMethod = AUTH_METHOD_NONE;
		} else {
			throw new XError(XError.INVALID_ARGUMENT, 'No API credentials configured');
		}

		// Incremented on every request; used to set the JSONRPC id field
		this.requestCounter = 0;
		this.authRequestCounter = 0;

		// A promise that holds the execution of the authentication request. It will be generated
		// the first time authenticate() is called, and will be returned to each subsequent call.
		this.authPromise = null;
		this.authPromisePending = false;
	}

	/**
	* This function tries to set the access token before making requests.
	*
	* @method authenticate
	* @since v0.0.1
	* @param {Boolean} expired - If this is called because of an expired access token, set this flag.
	*/
	authenticate(expired) {
		if (expired) {
			this.accessTokenExpired = true;
			this.accessToken = null;
			this.authPromise = null;
		}

		if (this.authPromise && this.authPromisePending) return this.authPromise;
		if (this.accessToken) return Promise.resolve(this.accessToken);
		if (this.authMethod === AUTH_METHOD_NONE) return Promise.resolve();

		let authPromiseHead;
		this.authPromisePending = true;
		if (this.authMethod === AUTH_METHOD_TOKEN) {
			if (this.accessTokenExpired) {
				authPromiseHead = Promise.reject(
					new XError(XError.TOKEN_EXPIRED, 'Provided access token has expired')
				);
			} else {
				authPromiseHead = Promise.resolve(this.originalAccessToken);
			}
		} else if (this.authMethod === AUTH_METHOD_CREDENTIALS) {
			let uri = this.getUrl({ auth: true });
			let jsonBody = {
				method: 'login',
				params: {
					userNamespaceId: this.userNamespaceId,
					email: this.email,
					password: this.password
				},
				id: this.authRequestCounter++
			};

			authPromiseHead = new Promise((resolve, reject) => {
				request({
					uri: uri,
					json: jsonBody,
					method: 'post'
				}, (err, response, body) => {
					if (err) return reject(err);
					resolve(body);
				});
			})
				.catch((err) => {
					throw new XError(XError.API_CLIENT_ERROR, err);
				})
				.then((response) => {
					if (response.error) {
						throw XError.fromObject(response.error);
					} else if (response.result && response.result.accessToken) {
						return response.result.accessToken;
					} else {
						throw new XError(XError.API_CLIENT_ERROR, 'login response didnt include an access token');
					}
				});
		} else {
			return Promise.reject(
				new XError(XError.INTERNAL_ERROR, 'Tried to authenticate with no credentials provided')
			);
		}

		this.authPromise = authPromiseHead
			.then((accessToken) => {
				this.accessToken = accessToken;
				this.accessTokenExpired = false;
				this.authPromisePending = false;
				return accessToken;
			})
			.catch((err) => {
				this.accessToken = null;
				this.authPromisePending = false;
				throw err;
			});
		return this.authPromise;
	}

	/**
	* Construct the URL to which JSONRPC requests will be placed.
	*
	* @method getUrl
	* @param {Object} [options={}]
	*  @param {Boolean} [options.auth=false] - Returns the auth server URL instead of the main server.
	* @since v0.0.1
	*/
	getUrl(options = {}) {
		let server = options.auth ? this.authServer : this.server;
		let version = options.auth ? this.authRouteVersion : this.routeVersion;
		// Fenangling to get legacy auth version to work properly
		let routeVersion = this.routeVersion;
		if (options.auth && !this.legacyAuth) {
			routeVersion = this.authRouteVersion;
		}
		return `${ server }/v${ routeVersion }/jsonrpc`;
	}


	/**
	* This takes the current accessToken and turns it in to the Bearer Authorization token
	*
	* @method createBearerHeader
	* @param {String} accessToken - the access token
	* @since v0.0.1
	*/
	createBearerHeader(accessToken) {
		if (!accessToken) return {};
		return { Authorization: `Bearer ${ new Buffer(accessToken).toString('base64') }` };
	}

	/**
	* Makes a request to the json-rpc service, handling authentication if necessary
	*
	* @method request
	* @param {String} method - the api method to call, in dot notation
	* @param {Object} params - the params for this api method
	* @param {Object} [opts]
	*   @param {Number} [id=requestCounter++] - the id to use for the request
	*   @param {Object} [opts.exHeaders] - Object containing additional headers to use for the request.
	*   @param {Number} [opts.maxRetries] - Number of times to retry the req
	*   @param {Boolean} [opts.noReauth] - Throw token_expired errors instead of reauthenticating.
	* @return {Promise} - resolves with the response that contains an object { error, result, id }
	* @since v0.0.1
	*/
	request(method, params, opts = {}) {
		let uri = this.getUrl();
		this.requestCounter++;
		let jsonBody = {
			method: method,
			params: params,
			id: opts.id || this.requestCounter
		};
		let maxRetries = opts.maxRetries || 1;
		let retryCount = 0;
		let requestErr = null;
		let requestRes = null;
		let success = false;

		return pasync.whilst(() => {
			if (success) return false;
			return (retryCount < maxRetries);
		}, () => {
			return this.authenticate()
				.then((accessToken) => {
					let headers = this.createBearerHeader(accessToken);
					if (opts.exHeaders) {
						_.assign(headers, opts.exHeaders);
					}
					return new Promise((resolve, reject) => {
						request({
							uri: uri,
							headers: headers,
							json: jsonBody,
							method: 'post'
						}, (err, response, body) => {
							if (err) return reject(err);
							resolve(body);
						});
					})
						.catch((err) => {
							throw new XError(XError.API_CLIENT_ERROR, err);
						});
				})
				.then((response) => {
					if (response.error) {
						// Check if we have a token expired error, and reauth if we do
						if (response.error.code === 'token_expired' && !opts.noReauth) {
							return this.authenticate(true);
						} else {
							retryCount++;
							requestErr = XError.fromObject(response.error);
							requestErr._isRemote = true;
						}
					} else {
						requestErr = null;
						success = true;
						requestRes = response.result || {};
					}
				});
		})
			.then((result) => {
				if (requestErr) throw requestErr;
				return requestRes;
			});
	}

	/**
	* Make a request to an endpoint that returns streaming data rather than the standard JSONRPC format. Data will
	* be returned as a readable zstream of parsed objects.
	*
	* @method requestStream
	* @param {String} method - the api method to call
	* @param {Object} params - the params for this api method
	* @param {Object} opts
	*   @param {Number} [id=requestCounter++] - the id to use for the request
	* @return {zstreams.PassThrough} - returns a passthrough stream that will recieve data
	*  when the request comes back.
	* @since v0.0.1
	*/
	requestStream(method, params, opts = {}) {
		let uri = this.getUrl();
		this.requestCounter++;
		let jsonBody = {
			method: method,
			params: params,
			id: opts.id || this.requestCounter
		};
		let hasDataOrError = false;
		let isSuccessful = false;
		let passThrough = new PassThrough({ objectMode: true });

		// Wrap the request stream in a pasync.whilst so we can retry on an expired token or similar error
		pasync.whilst(() => !hasDataOrError, () => {
			return this.authenticate()
				.then((accessToken) => {
					let headers = this.createBearerHeader(accessToken);
					if (opts.exHeaders) {
						_.assign(headers, opts.exHeaders);
					}
					let requestStream = zstreams.request({
						uri: uri,
						headers: headers,
						json: jsonBody,
						method: 'post'
					});
					return requestStream
						.pipe(new zstreams.SplitStream('\n'))
						.through((entry) => {
							let parsedEntry;
							try {
								parsedEntry = JSON.parse(entry);
							} catch (error) {
								throw new XError(
									XError.API_CLIENT_ERROR,
									'Received invalid line from request stream',
									{ line: entry },
									error
								);
							}

							if (parsedEntry.keepAlive === true) {
								// Keepalive object; discard it
								return null;
							}
							if (parsedEntry.success === true) {
								// Success object; flag success and discard
								isSuccessful = true;
								return null;
							}

							if (parsedEntry.error) {
								let streamErr = XError.fromObject(parsedEntry.error);
								streamErr._isRemote = true;
								throw streamErr;
							}

							// Otherwise, we have a normal chunk of data
							hasDataOrError = true;
							if (isSuccessful) {
								throw new XError(XError.INTERNAL_ERROR, 'Received line of data after success object');
							}
							return new Promise((resolve, reject) => {
								passThrough.write(parsedEntry, (error) => {
									if (error) return reject(error);
									return resolve();
								});
							});
						})
						.intoPromise()
						.then(() => {
							if (!isSuccessful) {
								throw new XError(
									XError.API_CLIENT_ERROR,
									'Never recieved successful end of data for request stream'
								);
							}
						})
						.catch((err) => {
							// If error was a token_expired, reauthenticate and try again
							if (err.code === 'token_expired' && !opts.noReauth) {
								return this.authenticate(true);
							} else {
								hasDataOrError = true;
								throw err;
							}
						});

				});
		})
			.then(() => {
				passThrough.end();
			})
			.catch((err) => {
				passThrough.emit('error', err);
			})
			.catch(pasync.abort);

		return passThrough;
	}

}

module.exports = ZipsceneRPCClient;
