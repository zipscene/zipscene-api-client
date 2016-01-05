const pasync = require('pasync');
const request = require('request-promise');
const XError = require('xerror');
const _ = require('lodash');
const { Promise } = require('es6-promise');
const zstreams = require('zstreams');
const PassThrough = require('zstreams').PassThrough;
const decamelize = require('decamelize');
const DEFAULT_ROUTE_VERSION = 2;

// register API_CLIENT_ERROR XError error code
XError.registerErrorCode('api_client_error', { message: 'API Client internal or authorization error' });
XError.registerErrorCode('unexpected_end', { message: 'Never recieved successful end of data for request stream' });
/**
 * This class passes jsonrpc requests to a server. It will authenticate
 * with a username and password. It will refresh an accessToken
 * when it expires.
 *
 * @class JsonRPCApiClient
 * @constructor
 * @param {Object} settings - settings object for authentication and sever set up
 *	@param {String} settings.server - the server location to make requests
 *  @param {String} settings.authServer - the server to authenticate with when different from
 *		the server to make requests on.
 *  @param {Number} [settings.routeVersion=2] - the route version to use when making requests
 *	@param {String} settings.username - the username to authenticate with
 *	@param {String} settings.password - the password to authenticate with
 * 	@param {String} settings.accessToken - the accessToken to use to make requests
 *  @param {String} settings.refreshToken - the refreshToken to use to authenticate with
 * @since v0.0.1
 */
class JsonRPCApiClient {

	constructor(settings) {
		let clientSettings = [ 'server', 'username', 'password', 'accessToken', 'refreshToken' ];
		_.extend(this, _.pick(settings, clientSettings));

		this.authServer = settings.authServer || this.server;
		this.routeVersion = settings.routeVersion || DEFAULT_ROUTE_VERSION;

		if (!this.server) {
			throw new XError(XError.INVALID_ARGUMENT, 'Server must be set to make requests');
		}

		if (!this.accessToken && !this.refreshToken && !(this.username && this.password)) {
			let msg = 'Settings must set username and password or authToken or refreshToken';
			throw new XError(XError.INVALID_ARGUMENT, msg);
		}

		this.requestCounter = 0;
	}

	/**
	* This function tries to set the access token before making requests.
	* Using either the given accessToken, a refreshToken or username and password.
	*
	* @method authenticate
	* @since v0.0.1
	*/
	authenticate() {
		if (this.authPromise) {
			return this.authPromise;
		} else if (this.accessToken) {
			this.authPromise = Promise.resolve();
		} else if (this.refreshToken) {
			this.authPromise = this._refreshRequest()
				.catch((err) => {
					let { code } = err;
					let badToken = code === 'token_expired' || code === 'bad_access_token';
					if (badToken && this.username && this.password) {
						return this._loginRequest();
					} else {
						throw new XError(err);
					}
				});
		} else if (this.username && this.password) {
			this.authPromise = this._loginRequest();
		} else {
			this.authPromise = Promise.reject('Unable to authenticate or refresh with given parameters');
		}

		return this.authPromise
			.then(() => this.authPromise = null)
			.catch((err) => {
				this.authPromise = null;
				throw new XError(XError.API_CLIENT_ERROR, err);
			});
	}

	/**
	* This is a helper function that will build a url for json rpc routes
	*
	* @method getUrl
	* @param {Object} [options={}]
	*  @param {Boolean} [options.auth=false] - use auth server
	* @since v0.0.1
	*/
	getUrl(options = {}) {
		let server = options.auth ? this.authServer : this.server;
		return `${ server }/v${ this.routeVersion }/jsonrpc`;
	}

	/**
	* This makes a request to auth.refresh with the given refresh token
	*
	* @method _refreshRequest
	* @private
	* @since v0.0.1
	*/
	_refreshRequest() {
		let uri = this.getUrl({ auth: true });
		let json = {
			method: 'auth.refresh',
			params: { refreshToken: this.refreshToken },
			id: this.requestCounter++
		};

		return request({ uri, json, method: 'post' })
			.catch((err) => { throw new XError(XError.API_CLIENT_ERROR, err); })
			.then((response) => {
				if (response.error) {
					throw new XError(response.error);
				} else if (response.result) {
					this.accessToken = response.result.access_token;
				} else {
					let msg = 'auth.refresh response didnt include an access token';
					throw new XError(XError.API_CLIENT_ERROR, msg);
				}
			});
	}

	/**
	* This makes a request to auth.password with the given username and password.
	* This defaults usernamespace to zs.
	*
	* @method _loginRequest
	* @private
	* @since v0.0.1
	*/
	_loginRequest() {
		let { username, password } = this;

		let uri = this.getUrl({ auth: true });
		let json = {
			method: 'auth.password',
			params: { ns: 'zs', username, password },
			id: this.requestCounter++
		};

		return request({ uri, json, method: 'post' })
			.catch((err) => { throw new XError(XError.API_CLIENT_ERROR, err); })
			.then((response) => {
				if (response.error) {
					throw new XError(XError.API_CLIENT_ERROR, response.error);
				} else if (response.result) {
					this.accessToken = response.result.access_token;
					this.refreshToken = response.result.refresh_token;
				} else {
					let msg = 'auth.password response didnt include an access token';
					throw new XError(XError.API_CLIENT_ERROR, msg);
				}
			});
	}

	/**
	* This takes the current accessToken and turns it in to the Bearer Authorization token
	*
	* @method _createBearerHeader
	* @private
	* @param {String} accessToken - the access token
	* @since v0.0.1
	*/
	_createBearerHeader(accessToken) {
		return { Authorization: `Bearer ${ new Buffer(accessToken).toString('base64') }` };
	}

	/**
	* Makes a request to the json-rpc service, handling authentication if necessary
	*
	* @method request
	* @param {String} method - the api method to call, in dot notation
	* @param {Object} params - the params for this api method
	* @param {Number} [id=requestCounter++] - the id to use for the request
	* @return {Promise} - resolves with the response that contains an object { error, result, id }
	* @since v0.0.1
	*/
	request(method, params, id = null) {
		let uri = this.getUrl();
		id = id || this.requestCounter++;
		let json = { method, params, id };

		return pasync.retry(2, () => {
			return this.authenticate()
				.then(() => {
					let headers = this._createBearerHeader(this.accessToken);
					return request({ uri, headers, json, method: 'post' })
						.catch((err) => { throw new XError(XError.API_CLIENT_ERROR, err); });
				})
				.then((response) => {
					// only want to throw an error to retry if the accessToken needs to be reset
					if (response.error) {
						this._rethrowAuthorizationError(response.error);
					}
					return response;
				});
		})
		.then((response) => {
			if (response.error) { throw new XError(response.error); }
			delete response.error;
			return response;
		});
	}

	/**
	* This takes an error and if it is an authorization error it throws the error
	*  to get retry the request.
	*
	* @method _rethrowAuthorizationError
	* @private
	* @param {Object} error - the error from a request
	* @since v0.0.1
	*/
	_rethrowAuthorizationError(error) {
		let { code } = error;
		if (code === 'token_expired' || code === 'bad_access_token') {
			this.accessToken = null;
			throw new XError(error);
		}
	}

	/**
	* Makes an export request to the json-rpc service, returns a stream
	* It will handle try to reauthenticate once if needed, otherwise it will emit
	*  all errors onto the returned stream.
	*
	* @method export
	* @param {String} profileName - the profile types that will be exported
	* @param {Object} params - the params for this api method
	*  @param {Object} [query={}] - the query to filter the exported data
	*  @param {String[]} fields - the fields to return
	*  @param {String[]} sort - list of field names to sort by
	* @return {zstreams.PassThrough} - returns a passthrough stream that will recieve data
	*  when the request comes back.
	* @since v0.0.1
	*/
	export(profileName, params = {}) {
		let passThrough = new PassThrough();
		if (!params.query) params.query = {};
		let uri = this.getUrl();
		let method = `${decamelize(profileName, '-')}.export`;
		let json = { method, params, id: this.requestCounter++ };
		let lastSeenDataObj;
		let errorCount = 0;
		let hasWritten = false;

		// authenticate and create a header
		let authenticateAndMakeHeaders = () => {
			return this.authenticate()
				.then(() => this._createBearerHeader(this.accessToken))
				.catch((error) => {
					// if authenticate throws an error it cannot authenticate emit the error
					return passThrough.emit('error', error);
				});
		};

		// set up handling of error events
		let setUpStreamErrorListener = (stream) => {
			stream.on('error', (error) => {
				// when an error occurs at request level do not retry just emit error
				return passThrough.emit('error', error);
			});
		};

		// set up handling end events
		// case - last entry was { success: true } - end pass through
		// case - request stream ended with out { successs: true } - emit an error that end of data was unexpected
		// case - last entry contained an errro that was non auth - emit error on pass through
		// case - there was an auth error - reset authError bool.
		let setUpStreamEndListener = (stream) => {
			stream.on('end', () => {
				if (lastSeenDataObj.success) {
					return passThrough.end();
				}

				if (lastSeenDataObj.error) {
					return passThrough.emit('error', lastSeenDataObj.error);
				}

				if (hasWritten && !lastSeenDataObj.success) {
					return passThrough.emit('error', new XError(XError.UNEXPECTED_END));
				}

			});
		};

		// make the request into a zstream, setup listeners and return requestStream
		let createRequestStream = (headers) => {
			let requestStream = zstreams.request({ uri, headers, json, method: 'post' });
			setUpStreamErrorListener(requestStream);
			setUpStreamEndListener(requestStream);
			return requestStream;
		};

		// take an entry and write it to the pass through steam
		let writeToPassThrough = (entry) => {
			return new Promise((resolve, reject) => {
				passThrough.write(entry, (err) => {
					// return reject(new XError(XError.INTERNAL_ERROR, 'Something happened on write.'));
					if (err) return reject(err);
					return resolve();
				});
			});
		};
		// this function - authenticates, creates header, makes request into a stream, and sets up the listen events
		// the stream waits for data from the request and checks to see if it is error.
		// if it is not an error it writes to the pass through stream.
		// if it is an auth error it changes the lastSeenObj to an empty object, ends the request stream and retries
		// if it is a non-auth error it ends the request stream that will emit the error.
		let dataToPassThrough = () => {
			authenticateAndMakeHeaders()
				.then((headers) => createRequestStream(headers))
				.then((stream) => {
					return stream.each((entry) => {
						let parsedEntry = JSON.parse(entry);
						lastSeenDataObj = parsedEntry;
						if (parsedEntry.error) {
							let error = parsedEntry.error;
							errorCount++;
							if (errorCount === 1) {
								try {
									this._rethrowAuthorizationError(error);
								} catch (error) {
									lastSeenDataObj = {};
									stream.end();
									return dataToPassThrough();
								}
							}
							stream.end();
							return Promise.reject(lastSeenDataObj);
						} else {
							return writeToPassThrough(entry)
								.then(() => hasWritten = true )
								.catch((err) => passThrough.emit('error', err));
						}
					});
				});
		};
		dataToPassThrough();

		return passThrough;
	}
}

module.exports = { JsonRPCApiClient };
