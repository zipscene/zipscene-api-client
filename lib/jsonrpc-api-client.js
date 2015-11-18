const pasync = require('pasync');
const request = require('request-promise');
const XError = require('xerror');

const DEFAULT_ROUTE_VERSION = 2;

/**
 *
 * This class passes jsonrpc requests to a server. It will authenticate
 * with a username and password. It will refresh an accessToken
 * when it expires.
 *
 * @class JsonRPCApiClient
 * @constructor
 * @param {Object} settings - settings object for authentication and sever set up
 *	@param {String} settings.server - the server location to make requests
 *	@param {String} settings.username - the username to authenticate with
 *	@param {String} settings.password - the password to authenticate with
 * 	@param {String} settings.accessToken - the accessToken to use to make requests
 *  @param {String} settings.refreshToken - the refreshToken to use to authenticate with
 * @param {Object} [options={}]
 *  @param {String} options.authServer - the server to authenticate with when different from
 *  the server to make requests on.
 *  @param {Number} [options.routeVersion=2] - the route version to use when making requests
 * @since v0.0.1
 */
class JsonRPCApiClient {

	constructor(settings, options = {}) {
		this.server = settings.server;
		this.username = settings.username;
		this.password = settings.password;
		this.accessToken = settings.accessToken;
		this.refreshToken = settings.refreshToken;
		this.authServer = options.authServer || this.server;
		this.routeVersion = options.routeVersion || DEFAULT_ROUTE_VERSION;
		if (!this.server) {
			throw new XError(XError.INVALID_ARGUMENT, 'Server must be set to make requests');
		}

		if (!this.accessToken && !this.refreshToken && !(this.username && this.password)) {
			throw new XError(
				XError.INVALID_ARGUMENT,
				'Settings must set username and password or authToken or refreshToken');
		}

		this.authWaiter = pasync.waiter();
		this.authentication()
		.then( () => {
			return this.authWaiter.resolve();
		})
		.catch( (error) => {
			return this.authWaiter.reject(error);
		});
	}

	/**
	*
	* This function tries to set the access token before making requests.
	* Using either the given accessToken, a refreshToken or username and password.
	*
	* @method authentication
	* @since v0.0.1
	*/
	authentication() {
		if (this.accessToken) {
			return Promise.resolve();
		} else if (this.refreshToken) {
			return this._refreshRequest()
			.catch( (error) => {
				if (error.code === 'bad_access_token' && this.username && this.password) {
					return this._loginRequest();
				}
			});
		} else {
			return this._loginRequest();
		}
	}

	/**
	*
	* This is a helper function that will build a url for json rpc routes
	*
	* @method getUrl
	* @param {Object} [options={}]
	*  @param {Boolean} [options.auth=false] - use auth server
	* @since v0.0.1
	*/
	getUrl(options = {}) {
		if (options.auth) {
			return `${this.authServer}/${this.routeVersion}v/jsonrpc`;
		}
		return `${this.server}/${this.routeVersion}v/jsonrpc`;
	}

	/**
	*
	* This makes a request to auth.refresh with the given refresh token
	*
	* @method _refreshRequest
	* @private
	* @since v0.0.1
	*/
	_refreshRequest() {
		let options = {
			uri: this.getUrl({ auth: true }),
			json: {
				method: 'auth.refresh',
				params: {
					refreshToken: this.refreshToken
				},
				id: 1
			}
		};
		return request(options)
		.then( (response) => {
			if (response.error) {
				throw response.error;
			}
			if (response.result) {
				this.accessToken = response.result.accessToken;
			}
		});
	}

	/**
	*
	* This makes a request to auth.password with the given username and password.
	* This defaults usernamespace to zs.
	*
	* @method _loginRequest
	* @private
	* @since v0.0.1
	*/
	_loginRequest() {
		let options = {
			uri: this.getUrl({ auth: true }),
			json: {
				method: 'auth.password',
				params: {
					ns: 'zs',
					username: this.username,
					password: this.password
				},
				id: 1
			}
		};
		return request(options)
		.then( (response) => {
			if (response.error) {
				throw response.error;
			}
			if (response.result) {
				this.accessToken = result.accessToken;
				this.refreshToken = result.refreshToken;
			}
		});
	}

	/**
	*
	* This makes a request to auth.password with the given username and password.
	* This defaults usernamespace to zs.
	*
	* @method request
	* @param {String} method - the api method to call, in dot notation
	* @param {Object} params - the params for this api method
	* @param {id} id - the id for the request.
	* @return {Promise} - resolves with the response that contains an object { error: , result, id }
	* @since v0.0.1
	*/
	request(method, params, id) {
		return pasync.retry(2, () => {
			return this.authWaiter.promise
			.then( () => {
				let options = {
					uri: this.getUrl(),
					qs: { access_token: this.accessToken },
					json: { method, params, id }
				};
				return request(options); 
			})
			.then( (response) => {
				// only want to throw an error to retry if the accessToken needs to be reset
				if (response.error && response.error.code === 'token_expired') {
					this.accessToken = null;
					this.authWaiter.reset(); 
					throw response.error;
				}
				return response;
			});
		});
	}
}

module.exports = JsonRPCApiClient;
