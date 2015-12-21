const pasync = require('pasync');
const requestPromise = require('request-promise');
const request = require('request');
const XError = require('xerror');
const _ = require('lodash');
const { Promise } = require('es6-promise');
const zstreams = require('zstreams');
const decamelize = require('decamelize');
const DEFAULT_ROUTE_VERSION = 2;

// register API_CLIENT_ERROR XError error code
XError.registerErrorCode('API_CLIENT_ERROR', { message: 'API Client internal or authorization error' });

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
					let { code } = error;
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

		return requestPromise({ uri, json, method: 'post' })
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

		return requestPromise({ uri, json, method: 'post' })
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
	* @since v0.0.1
	*/
	_createBearerHeader() {
		return { Authorization: `Bearer ${ new Buffer(this.accessToken).toString('base64') }` };
	}

	/**
	* Makes a request to the json-rpc service, handling authentication if necessary
	*
	* @method request
	* @param {String} method - the api method to call, in dot notation
	* @param {Object} params - the params for this api method
	* @return {Promise} - resolves with the response that contains an object { error, result, id }
	* @since v0.0.1
	*/
	request(method, params) {
		let uri = this.getUrl();
		let json = { method, params, id: this.requestCounter++ };

		return pasync.retry(2, () => {
			return this.authenticate()
				.then(() => {
					let headers = this._createBearerHeader();
					return requestPromise({ uri, headers, json, method: 'post' })
						.catch((err) => { throw new XError(XError.API_CLIENT_ERROR, err); });
				})
				.then((response) => {
					// only want to throw an error to retry if the accessToken needs to be reset
					if (response.error) {
						let { code } = response.error;
						if (code === 'token_expired' || code === 'bad_access_token') {
							this.accessToken = null;
							return this.authenticate()
								.then(() => { throw new XError(response.error); });
						}
					}
					return response;
				});
		})
		.then((response) => {
			if (response.error) { throw new XError(response.error); }
			return response.result;
		});
	}

	/**
	* Makes an export request to the json-rpc service, returns a stream
	* This method will __NOT__ handle authentication and refreshing the accessTokens.
	*
	* @method request
	* @param {String} profileName - the profile types that will be exported
	* @param {Object} params - the params for this api method
	*  @param {Object} [query={}] - the query to filter the exported data
	*  @param {String[]} fields - the fields to return
	*  @param {String[]} sort - list of field names to sort by
	* @return {Promise} - resolves with a response stream of json stringified object where the last object is success: true
	* @since v0.0.1
	*/
	export(profileName, params = {}) {
		if (!params.query) params.query = {};
		let uri = this.getUrl();
		let method = `${decamelize(profileName, '-')}.export`;
		let json = { method, params, id: this.requestCounter++ };
		return pasync.retry(2, () => {
			return this.authenticate()
				.then(() => this._createBearerHeader())
				.then((headers) => {
					return new Promise((resolve, reject) => {
						let self = this;
						let resStream = zstreams(request({ uri, headers, json, method: 'post' }));
						resStream.through(function(data) {
							let tmpData = JSON.parse(data);
							if (tmpData.error) {
								let { code } = tmpData.error;
								if (code === 'token_expired' || code === 'bad_access_token') {
									self.accessToken = null;
								}
								return reject(tmpData.error);
							}
							this.push(data);
							// if there was an error on the data it would have an error object
							// else when the stream is ending { success: true } is the end of the stream
							if (tmpData.success) {
								return resolve(this);
							}
						});
					});
				});
		});
	}
}

module.exports = { JsonRPCApiClient };
