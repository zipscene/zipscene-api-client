const DMPAPIApp = require('zs-dmp-api/dist/src/dmp-api-app');
const expect = require('chai').expect;
const pasync = require('pasync');
const XError = require('xerror');
const _ = require('lodash');
const zstreams = require('zstreams');
const { DMPCore } = require('zs-dmp-core');
const { ZSApi } = require('zs-api-client');

const { JsonRPCApiClient } = require('../lib/jsonrpc-api-client');

const TestServices = require('./lib/test-services');

let {
	JSON_RPC_PORT,
	AUTH_PORT,
	OLD_ZS_API_PORT,
	DEFAULT_JSON_RPC_SERVER,
	DEFAULT_AUTH_SERVER,
	OLD_ZS_API_SERVER,
	DEFAULT_USERNAME,
	DEFAULT_PASSWORD,
	DEFAULT_ACCESS_TOKEN,
	DEFAULT_REFRESH_TOKEN,
	DEFAULT_ROUTE_VERSION
} = require('./project-config');

const DEFAULT_SETTINGS = {
	server: DEFAULT_JSON_RPC_SERVER,
	username: DEFAULT_USERNAME,
	password: DEFAULT_PASSWORD
};

const DEFAULT_OLD_ZS_API_SETTINGS = {
	server: OLD_ZS_API_SERVER,
	username: DEFAULT_USERNAME,
	password: DEFAULT_PASSWORD
};

describe('JsonRPCApiClient', function() {

	before(function() {
		this.timeout(99999);
		this.services = new TestServices();
		return this.services.setUpServices();
	});

	after(function() { return this.services.tearDownServices(); });

	before(function() {
		let dmpCoreConfig = { mongo: { uri: this.services.mongoUri } };
		let dmp = new DMPCore(dmpCoreConfig);
		this.appApi = new DMPAPIApp(dmp, { config: { port: JSON_RPC_PORT, oldZsapi: DEFAULT_OLD_ZS_API_SETTINGS } });
		this.authApi = new DMPAPIApp(dmp, { config: { port: AUTH_PORT, oldZsapi: DEFAULT_OLD_ZS_API_SETTINGS } });
	});

	after(function() { return this.appApi.stop() && this.authApi.stop(); });

	describe('#constructor', function() {
		it('should set all the settings given', function() {
			let client = new JsonRPCApiClient({
				server: DEFAULT_JSON_RPC_SERVER,
				authServer: DEFAULT_AUTH_SERVER,
				routeVersion: 3,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD,
				accessToken: DEFAULT_ACCESS_TOKEN,
				refreshToken: DEFAULT_REFRESH_TOKEN
			});
			expect(client.server).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.authServer).to.equal(DEFAULT_AUTH_SERVER);
			expect(client.username).to.equal(DEFAULT_USERNAME);
			expect(client.password).to.equal(DEFAULT_PASSWORD);
			expect(client.accessToken).to.equal(DEFAULT_ACCESS_TOKEN);
			expect(client.refreshToken).to.equal(DEFAULT_REFRESH_TOKEN);
			expect(client.routeVersion).to.equal(3);
		});

		it('should throw an error if server is not set', function() {
			expect(() => new JsonRPCApiClient({}))
				.to.throw(XError.INVALID_ARGUMENT, 'Server must be set to make a request');
		});

		it('should throw an error if no authentication is set', function() {
			let expectedMsg = 'Settings must set username and password or authToken or refreshToken';
			expect(() => new JsonRPCApiClient({ server: DEFAULT_JSON_RPC_SERVER }))
				.to.throw(XError.INVALID_ARGUMENT, expectedMsg);
		});

		it('should not throw an error when only auth is username and password', function() {
			let client = new JsonRPCApiClient(DEFAULT_SETTINGS);
			expect(client.server).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.authServer).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.username).to.equal(DEFAULT_USERNAME);
			expect(client.password).to.equal(DEFAULT_PASSWORD);
			expect(client.routeVersion).to.equal(2);
			expect(client.accessToken).to.be.undefined;
			expect(client.refreshToken).to.be.undefined;
		});

		it('should not throw an error when only accessToken is set', function() {
			let settings = {
				server: DEFAULT_JSON_RPC_SERVER,
				accessToken: DEFAULT_ACCESS_TOKEN
			};
			let client = new JsonRPCApiClient(settings);
			expect(client.server).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.authServer).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.accessToken).to.equal(DEFAULT_ACCESS_TOKEN);
			expect(client.routeVersion).to.equal(2);
			expect(client.username).to.be.undefined;
			expect(client.password).to.be.undefined;
			expect(client.refreshToken).to.be.undefined;
		});

		it('should not throw an error when only refreshToken is set', function() {
			let settings = {
				server: DEFAULT_JSON_RPC_SERVER,
				refreshToken: DEFAULT_REFRESH_TOKEN
			};
			let client = new JsonRPCApiClient(settings);
			expect(client.server).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.authServer).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.refreshToken).to.equal(DEFAULT_REFRESH_TOKEN);
			expect(client.routeVersion).to.equal(2);
			expect(client.username).to.be.undefined;
			expect(client.password).to.be.undefined;
			expect(client.accessToken).to.undefined;
		});
	});

	describe('#authenticate', function() {
		it('sends a request to auth.password w/ a username and password', function() {
			this.timeout(9999);
			let waiter = pasync.waiter();
			// wrap the middleware function in `_.once()` since post-middleware cannot yet be added to a specific method
			this.authApi.apiRouter.registerPostMiddleware({}, _.once((ctx) => {
				try {
					expect(ctx.error).to.not.exist;
					expect(ctx.result).to.be.an.object;
					expect(ctx.result.access_token).to.be.a.string;
					expect(ctx.result.refresh_token).to.be.a.string;
					return waiter.resolve();
				} catch (err) {
					return waiter.reject(err);
				}
			}));

			let client = new JsonRPCApiClient({
				server: DEFAULT_JSON_RPC_SERVER,
				authServer: DEFAULT_AUTH_SERVER,
				routeVersion: DEFAULT_ROUTE_VERSION,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD
			});

			return client.authenticate()
				.then(() => {
					expect(client.accessToken).to.be.a.string;
					expect(client.refreshToken).to.be.a.string;
				});
		});

		it('sends a request to auth.refresh w/ a refresh token', function() {
			let waiter = pasync.waiter();
			let client;

			// use the old zs-api client to get a valid refresh token
			let oldZsApiOptions = {
				server: OLD_ZS_API_SERVER,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD
			};
			let oldZsApiClient = new ZSApi(oldZsApiOptions);
			oldZsApiClient.post('auth/zs/password', oldZsApiOptions, (err, res) => {
				if (err) { return waiter.reject(err); }

				// wrap the middleware function in `_.once()` since post-middleware
				// cannot yet be added to a specific method
				this.authApi.apiRouter.registerPostMiddleware({}, _.once((ctx) => {
					try {
						expect(ctx.error).to.not.exist;
						expect(ctx.result).to.be.an.object;
						expect(ctx.result.access_token).to.be.a.string;
						expect(ctx.result.refresh_token).to.be.a.string;
						expect(ctx.params.refreshToken).to.equal(res.refresh_token);
						return waiter.resolve();
					} catch (err) {
						return waiter.reject(err);
					}
				}));

				client = new JsonRPCApiClient({
					server: DEFAULT_JSON_RPC_SERVER,
					authServer: DEFAULT_AUTH_SERVER,
					routeVersion: DEFAULT_ROUTE_VERSION,
					refreshToken: res.refresh_token
				});

				return client.authenticate();
			});
			return waiter.promise
				.then(() => expect(client.accessToken).to.be.a.string);
		});

	});

	describe('#getUrl', function() {

		before(function() {
			this.client = new JsonRPCApiClient({
				server: DEFAULT_JSON_RPC_SERVER,
				authServer: DEFAULT_AUTH_SERVER,
				routeVersion: DEFAULT_ROUTE_VERSION,
				accessToken: DEFAULT_ACCESS_TOKEN
			});
		});

		it('returns the JsonRPC server url w/ no argument', function() {
			let expectedUrl = `${ DEFAULT_JSON_RPC_SERVER }/v${ DEFAULT_ROUTE_VERSION }/jsonrpc`;
			expect(this.client.getUrl()).to.equal(expectedUrl);
		});

		it('returns the auth server url w/ `{ auth: true }`', function() {
			let expectedUrl = `${ DEFAULT_AUTH_SERVER }/v${ DEFAULT_ROUTE_VERSION }/jsonrpc`;
			expect(this.client.getUrl({ auth: true })).to.equal(expectedUrl);
		});

	});

	describe('#request', function() {
		it('sends a request to the rpc url', function() {
			this.timeout(99999);
			let waiter = pasync.waiter();

			let client = new JsonRPCApiClient(DEFAULT_SETTINGS);

			return client.authenticate()
				.then(() => {
					let method = 'getAPIInfo';
					// we have to add this after the client has finished authenticating
					this.appApi.apiRouter.registerPostMiddleware({}, _.once((ctx) => {
						try {
							expect(ctx.method).to.equal(method);
							return waiter.resolve();
						} catch (err) {
							return waiter.reject(err);
						}
					}));
					return client.request(method);
				})
				.then(() => waiter.promise);
		});

		it('reauthenticates if access_token is invalid', function() {
			this.timeout(99999);
			let waiter = pasync.waiter();

			let client = new JsonRPCApiClient({
				server: DEFAULT_JSON_RPC_SERVER,
				accessToken: DEFAULT_ACCESS_TOKEN,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD
			});

			let method = 'auth-required';
			let authMiddleware = this.appApi.authenticator.getAuthMiddleware();
			this.appApi.apiRouter.register({ method }, authMiddleware, (ctx) => {
				try {
					expect(ctx.method).to.equal(method);
					return waiter.resolve();
				} catch (err) {
					return waiter.reject(err);
				}
			});

			return client.request(method)
				.then(() => waiter.promise)
				.then(() => expect(client.accessToken).to.not.equal(DEFAULT_ACCESS_TOKEN));
		});
	});

	describe('#export', function() {
		it('sends an export request to the rpc url', function() {
			this.timeout(99999);

			let waiter = pasync.waiter();

			let client = new JsonRPCApiClient({
				server: DEFAULT_JSON_RPC_SERVER,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD
			});
			let method = 'person.export';
			let successfulResponse = JSON.stringify({ success: true });
			let data = JSON.stringify({ data: 123 });
			let authMiddleware = this.appApi.authenticator.getAuthMiddleware();
			this.appApi.apiRouter.register({ method }, authMiddleware, (ctx) => {
				try {
					expect(ctx.method).to.equal(method);
				} catch (err) {
					return waiter.reject(err);
				}
				let bufferData = new Buffer(data  + '\n', 'utf8');
				let bufferRespsonse = new Buffer(successfulResponse  + '\n', 'utf8');
				zstreams.fromArray([ bufferData, bufferRespsonse ]).pipe(ctx.res);
			});

			client.export('person')
				.then((response) => response.split().intoArray())
				.then((response) => {
					try {
						expect(response[0]).to.equal(data);
						expect(response[1]).to.equal(successfulResponse);
						return waiter.resolve();
					} catch (err) {
						return waiter.reject(err);
					}
				}, (error) => {
					return waiter.reject(error);
				})
				.catch((error) => {
					return waiter.reject(error);
				});

			return waiter.promise;
		});

		it('should throw an error when authentication could not occur', function() {
			this.timeout(99999);

			let waiter = pasync.waiter();

			let client = new JsonRPCApiClient({
				server: DEFAULT_JSON_RPC_SERVER,
				accessToken: DEFAULT_ACCESS_TOKEN
			});

			let method = 'person.export';

			let authMiddleware = this.appApi.authenticator.getAuthMiddleware();
			this.appApi.apiRouter.register({ method }, authMiddleware, (ctx) => {
				return waiter.reject(new XError(XError.INTERNAL_ERROR, 'should not have been able to authenticate'));
			});

			client.export('person')
				.then((response) => response.intoString())
				.catch((error) => {
					try {
						expect(error).to.exist;
						expect(error.code).to.equal('api_client_error');
						expect(error.message).to.equal('Unable to authenticate or refresh with given parameters');
						return waiter.resolve();
					} catch (error) {
						return waiter.reject(error);
					}
				});

			return waiter.promise;

		});
	});

});
