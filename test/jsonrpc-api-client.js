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

// TODO: configure ports
const JSON_RPC_PORT = 3000;
const AUTH_PORT = 3001;
const OLD_ZS_API_PORT = 3333;
const DEFAULT_JSON_RPC_SERVER = `http://localhost:${ JSON_RPC_PORT }`;
const DEFAULT_AUTH_SERVER = `http://localhost:${ AUTH_PORT }`;
const OLD_ZS_API_SERVER = `http://localhost:${ OLD_ZS_API_PORT }`;
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'Zip123';
const DEFAULT_ACCESS_TOKEN = 'accessToken1234';
const DEFAULT_REFRESH_TOKEN = 'refreshToken1234';
const DEFAULT_ROUTE_VERSION = 2;
const DEFAULT_SETTINGS = {
	server: DEFAULT_JSON_RPC_SERVER,
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

		let oldZsapi = {
			server: OLD_ZS_API_SERVER,
			username: DEFAULT_USERNAME,
			password: DEFAULT_PASSWORD
		};
		this.appApi = new DMPAPIApp(dmp, { config: { port: JSON_RPC_PORT, oldZsapi } });
		this.authApi = new DMPAPIApp(dmp, { config: { port: AUTH_PORT, oldZsapi } });
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
			expect(client.username).to.equal(DEFAULT_USERNAME);
			expect(client.password).to.equal(DEFAULT_PASSWORD);
			expect(client.accessToken).to.equal(DEFAULT_ACCESS_TOKEN);
			expect(client.refreshToken).to.equal(DEFAULT_REFRESH_TOKEN);
			expect(client.authServer).to.equal(DEFAULT_AUTH_SERVER);
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
			expect(client.username).to.equal(DEFAULT_USERNAME);
			expect(client.password).to.equal(DEFAULT_PASSWORD);
			expect(client.accessToken).to.be.undefined;
			expect(client.refreshToken).to.be.undefined;
			expect(client.authServer).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.routeVersion).to.equal(2);
		});

		it('should not throw an error when only accessToken is set', function() {
			let settings = {
				server: DEFAULT_JSON_RPC_SERVER,
				accessToken: DEFAULT_ACCESS_TOKEN
			};
			let client = new JsonRPCApiClient(settings);
			expect(client.server).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.username).to.equal(undefined);
			expect(client.password).to.equal(undefined);
			expect(client.accessToken).to.equal(DEFAULT_ACCESS_TOKEN);
			expect(client.refreshToken).to.equal(undefined);
			expect(client.authServer).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.routeVersion).to.equal(2);
		});

		it('should not throw an error when only refreshToken is set', function() {
			let settings = {
				server: DEFAULT_JSON_RPC_SERVER,
				refreshToken: DEFAULT_REFRESH_TOKEN
			};
			let client = new JsonRPCApiClient(settings);
			expect(client.server).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.username).to.equal(undefined);
			expect(client.password).to.equal(undefined);
			expect(client.accessToken).to.equal(undefined);
			expect(client.refreshToken).to.equal(DEFAULT_REFRESH_TOKEN);
			expect(client.authServer).to.equal(DEFAULT_JSON_RPC_SERVER);
			expect(client.routeVersion).to.equal(2);
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
			let successfulResponse = JSON.stringify({ success: true }) + '\n';
			let authMiddleware = this.appApi.authenticator.getAuthMiddleware();
			this.appApi.apiRouter.register({ method }, authMiddleware, (ctx) => {
				try {
					expect(ctx.method).to.equal(method);
				} catch (err) {
					return waiter.reject(err);
				}
				let bufferRespsonse = new Buffer(successfulResponse, 'utf8');
				zstreams.fromArray([ bufferRespsonse ]).pipe(ctx.res);
			});

			client.export('person')
				.then((response) => response.intoString())
				.then((response) => {
					try {
						expect(response).to.equal(successfulResponse);
						return waiter.resolve();
					} catch (err) {
						return waiter.reject(err);
					}
				}, (error) => {
					return waiter.reject(error);
				});

			return waiter.promise
				.then(() => { console.log('here before ending of test...'); });
		});

		it.only('should throw an error when authentication could not occur', function() {
			this.timeout(99999);

			let waiter = pasync.waiter();

			let client = new JsonRPCApiClient({
				server: DEFAULT_JSON_RPC_SERVER,
				authServer: DEFAULT_AUTH_SERVER,
				accessToken: DEFAULT_ACCESS_TOKEN
			});

			let method = 'person.export';

			let authMiddleware = this.appApi.authenticator.getAuthMiddleware();
			this.appApi.apiRouter.register({ method }, authMiddleware, (ctx) => {
				console.log('here...');
				return waiter.reject(new XError(XError.INTERNAL_ERROR, 'should not have been able to authenticate'));
			});
			console.log('requesting export...');
			client.export('person')
				.catch((error) => {
					console.log(error);
					expect(error).to.exist;
					expect(error.code).to.equal('api_client_error');
					return waiter.resolve();
				});

			console.log('returning waiter promise....')
			return waiter.promise
				.then(() => { console.log('here before ending of test...'); });

		});
	});

});
