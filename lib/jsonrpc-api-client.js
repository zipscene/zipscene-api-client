const pasync = require('pasync');
const request = require('request-promise');
const XError = require('xerror');
const _ = require('lodash');
const { Promise } = require('es6-promise');

const DEFAULT_ROUTE_VERSION = 2;

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
		if (this.accessToken) {
			return Promise.resolve();
		} else if (this.refreshToken) {
			return this._refreshRequest()
				.catch((err) => {
					let { code } = error;
					let badToken = code === 'token_expired' || code === 'bad_access_token';
					if (badToken && this.username && this.password) {
						return this._loginRequest();
					} else {
						throw new XError(err);
					}
				});
		} else {
			return this._loginRequest();
		}
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
			.then((response) => {
				if (response.error) {
					return Promise.reject(new XError(response.error));
				} else if (response.result) {
					this.accessToken = response.result.access_token;
				} else {
					let msg = 'auth.refresh response didnt include an access token';
					return Promise.reject(new XError(XError.NOT_FOUND, msg));
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
			.then((response) => {
				if (response.error) {
					return Promise.reject(new XError(response.error));
				} else if (response.result) {
					this.accessToken = response.result.access_token;
					this.refreshToken = response.result.refresh_token;
				} else {
					let msg = 'auth.password response didnt include an access token';
					return Promise.reject(new XError(XError.NOT_FOUND, msg));
				}
			});
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
					let headers = { Authorization: `Bearer ${ new Buffer(this.accessToken).toString('base64') }` };
					return request({ uri, headers, json, method: 'post' });
				})
				.then((response) => {
					// only want to throw an error to retry if the accessToken needs to be reset
					if (response.error) {
						let { code } = response.error;
						if (code === 'token_expired' || code === 'bad_access_token') {
							this.accessToken = null;
							return this.authenticate()
								.then(() => Promise.reject(new XError(response.error)));
						}
					}
					return response;
				});
		})
		.then((response) => {
			if (response.error) { return Promise.reject(new XError(response.error)); }
			return response;
		});
	}
}

module.exports = { JsonRPCApiClient };
