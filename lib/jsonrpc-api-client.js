const pasync = require('pasync');
const request = require('request-promise');
const XError = require('xerror');
const _ = require('lodash');
const { Promise } = require('es6-promise');
const zstreams = require('zstreams');
const PassThrough = require('zstreams').PassThrough;
const decamelize = require('decamelize');
const DEFAULT_ROUTE_VERSION = 2;
const DEFAULT_AUTH_ROUTE_VERSION = 1;

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
 *  @param {Number} [settings.authRouteVersion=1]
 *  @param {Boolean} settings.legacyAuth - If true, the client will authenticate against a legacy zsapi server.
 *  @param {String} settings.email - The email address to authenticate with.
 *	@param {String} settings.username - the username to authenticate with. If legacyAuth is not set,
 *    this is an alias to email.
 *	@param {String} settings.password - the password to authenticate with
 *  @param {String} settings.userNamespaceId - The user namespace the authenticated user belongs to.
 * 	@param {String} settings.accessToken - the accessToken to use to make requests
 *  @param {String} settings.refreshToken - the refreshToken to use to authenticate with (legacy auth only)
 * @since v0.0.1
 */
class JsonRPCApiClient {

	constructor(settings) {
		let clientSettings = [ 'server', 'legacyAuth', 'email', 'username',
			'password', 'userNamespaceId', 'accessToken', 'refreshToken' ];
		_.extend(this, _.pick(settings, clientSettings));
		// Default email to username
		if (!this.legacyAuth && this.username && !this.email) {
			this.email = this.username;
		}

		this.authServer = settings.authServer || this.server;
		this.routeVersion = settings.routeVersion || DEFAULT_ROUTE_VERSION;
		this.authRouteVersion = settings.authRouteVersion || DEFAULT_AUTH_ROUTE_VERSION;

		if (!this.server) {
			throw new XError(XError.INVALID_ARGUMENT, 'Server is not configured');
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
		} else if (this.refreshToken && this.legacyAuth) {
			this.authPromise = this._refreshRequest()
				.catch((err) => {
					let { code } = err;
					let badToken = code === 'token_expired' || code === 'bad_access_token';
					if (badToken && this.username && this.password) {
						return this._legacyLoginRequest();
					} else {
						throw new XError(err);
					}
				});
		} else if (this.username && this.password && this.legacyAuth) {
			this.authPromise = this._legacyLoginRequest();
		} else if (this.email && this.password && !this.legacyAuth) {
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
		// Fenangling to get legacy auth version to work properly
		let routeVersion = this.routeVersion;
		if (options.auth && !this.legacyAuth) {
			routeVersion = this.authRouteVersion;
		}
		return `${ server }/v${ routeVersion }/jsonrpc`;
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
	* @method _legacyLoginRequest
	* @private
	* @since v0.0.1
	*/
	_legacyLoginRequest() {
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
	* This makes a request to auth.password with the given username and password.
	*
	* @method _legacyLoginRequest
	* @private
	* @since v0.0.1
	*/
	_loginRequest() {
		let { email, password, userNamespaceId } = this;

		let uri = this.getUrl({ auth: true });
		let json = {
			method: 'login',
			params: { userNamespaceId, email, password },
			id: this.requestCounter++
		};

		return request({ uri, json, method: 'post' })
			.catch((err) => { throw new XError(XError.API_CLIENT_ERROR, err); })
			.then((response) => {
				if (response.error) {
					throw new XError(XError.API_CLIENT_ERROR, response.error);
				} else if (response.result) {
					this.accessToken = response.result.accessToken;
				} else {
					let msg = 'auth.password response didnt include an access token';
					throw new XError(XError.API_CLIENT_ERROR, msg);
				}
			});
	}

	/**
	* This takes the current accessToken and turns it in to the Bearer Authorization token
	*
	* @method createBearerHeader
	* @param {String} accessToken - the access token
	* @since v0.0.1
	*/
	createBearerHeader(accessToken) {
		return { Authorization: `Bearer ${ new Buffer(accessToken).toString('base64') }` };
	}

	/**
	* Makes a request to the json-rpc service, handling authentication if necessary
	*
	* @method request
	* @param {String} method - the api method to call, in dot notation
	* @param {Object} params - the params for this api method
	* @param {Number} [id=requestCounter++] - the id to use for the request
	* @param {Object} [opts]
	*   @param {Boolean} [opts.noAuth] - Do not fetch an access token for this request.
	*   @param {Object} [opts.exHeaders] - Object containing additional headers to use for the request.
	* @return {Promise} - resolves with the response that contains an object { error, result, id }
	* @since v0.0.1
	*/
	request(method, params, id = null, opts = {}) {
		let uri = this.getUrl();
		id = id || this.requestCounter++;
		let json = { method, params, id };

		return pasync.retry(2, () => {
			return Promise.resolve().then(() => {
				// Get access token, if applicable
				if (opts.noAuth) return null;
				this.authPromise = this.authenticate();
				return this.authPromise;
			}).then(() => {
				let headers;
				if (opts.noAuth) {
					headers = {};
				} else {
					headers = this.createBearerHeader(this.accessToken);
				}
				if (opts.exHeaders) {
					_.assign(headers, opts.exHeaders);
				}
				return request({ uri, headers, json, method: 'post' })
					.catch((err) => { throw new XError(XError.API_CLIENT_ERROR, err); });
			}).then((response) => {
				// only want to throw an error to retry if the accessToken needs to be reset
				if (response.error) {
					this._rethrowAuthorizationError(response.error);
				}
				return response;
			});
		})
		.then(({ error, result }) => {
			if (error) { throw new XError(error); }
			return result;
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
	* Make a request to an endpoint that returns streaming data rather than the standard JSONRPC format. Data will
	* be returned as a readable zstream of parsed objects.
	*
	* @method requestStream
	* @param {String} method - the api method to call
	* @param {Object} params - the params for this api method
	* @param {Number} [id=requestCounter++] - the id to use for the request
	* @return {zstreams.PassThrough} - returns a passthrough stream that will recieve data
	*  when the request comes back.
	* @since v0.0.1
	*/
	requestStream(method, params, id) {
		let uri = this.getUrl();
		id = id || this.requestCounter++;
		let json = {
			method,
			params: params || {},
			id };
		let passThrough = new PassThrough({ objectMode: true });


		// this function - authenticates, creates header, makes request into a stream, and sets up the listen events
		// the stream waits for data from the request and checks to see if it is error.
		// if it is not an error it writes to the pass through stream.
		// if it is an auth error it changes the lastSeenObj to an empty object, ends the request stream and retries
		// if it is a non-auth error it ends the request stream that will emit the error.
		let dataToPassThrough = (retryOnAuthFailure) => {
			// Flag to keep track of stream state
			let dataCount = 0;
			let isSuccessful = false;

			this.authenticate()
			.then(() => {
				return this.createBearerHeader(this.accessToken);
			}).then((headers) => {
				let requestStream = zstreams.request({ uri, headers, json, method: 'post' });
				return requestStream.pipe(new zstreams.SplitStream('\n')).through((entry) => {
					let parsedEntry;
					try {
						parsedEntry = JSON.parse(entry);
					} catch (error) {
						throw new XError(
							XError.INVALID_OBJECT,
							'Received invalid line from request stream',
							{ line: entry },
							error
						);
					}
					if (parsedEntry.keepAlive === true) {
						// Keepalive object; discard it
						return;
					}
					if (parsedEntry.success === true) {
						// Success object; flag success and discard
						isSuccessful = true;
						return;
					}
					if (parsedEntry.error) {
						let wrappedError = new XError(parsedEntry.error.code, parsedEntry.error.message);
						// We will mark retry IF this error is the first entry and it is an auth error
						if (dataCount === 0) {
							try {
								this._rethrowAuthorizationError(wrappedError);
							} catch(thrownError) {
								wrappedError.retry = true;
							}
						}
						throw wrappedError;
					}
					// Otherwise, we have a normal data chunk
					dataCount++;
					return new Promise((resolve, reject) => {
						passThrough.write(entry, (error) => {
							if (error) return reject(error);
							return resolve();
						});
					});
				}).intoPromise();
			}).then(() => {
				// End passthrough, assuming success conditions are met
				if (!isSuccessful) {
					throw new XError(XError.UNEXPECTED_END);
				}
				passThrough.end();
			}).catch((error) => {
				// Decide whether to re-emit error or try again
				if (error.retry && retryOnAuthFailure) {
					dataToPassThrough(false);
				} else {
					passThrough.emit('error', error);
				}
			}).catch(pasync.abort);
		};

		dataToPassThrough(true);
		return passThrough;
	}

	/**
	* Makes an export request to the json-rpc service, returns a stream
	* It will handle try to reauthenticate once if needed, otherwise it will emit
	*  all errors onto the returned stream.
	*
	* @method export
	* @deprecated - Just use requestStream instead
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
		if (!params.query) params.query = {};
		let method = `${decamelize(profileName, '-')}.export`;
		return this.requestStream(method, params);
	}
}

module.exports = { JsonRPCApiClient };
