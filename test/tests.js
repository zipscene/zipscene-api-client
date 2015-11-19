const expect = require('chai').expect;
const express = require('express');
const pasync = require('pasync');
const request = require('request-promise');
const url = require('url');
const XError = require('xerror');
const { APIRouter, JSONRPCInterface } = require('zs-api-router');
const { Promise } = require('es6-promise');

const { JsonRPCApiClient } = require('../lib/jsonrpc-api-client');

// TODO: configure ports
const JSON_RPC_PORT = 3000;
const AUTH_PORT = 3001;
const DEFAULT_JSON_RPC_SERVER = `http://localhost:${ JSON_RPC_PORT }`;
const DEFAULT_AUTH_SERVER = `http://localhost:${ AUTH_PORT }`;
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = '1234';
const DEFAULT_ACCESS_TOKEN = 'accessToken1234';
const DEFAULT_REFRESH_TOKEN = 'refreshToken1234';
const DEFAULT_ROUTE_VERSION = 2;

describe('JsonRPCApiClient', function() {

	describe('#constructor', function() {
		it('should set all the settings and options given', function() {
			let settings = {
				server: DEFAULT_JSON_RPC_SERVER,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD,
				accessToken: DEFAULT_ACCESS_TOKEN,
				refreshToken: DEFAULT_REFRESH_TOKEN
			};
			let options = {
				authServer: DEFAULT_AUTH_SERVER,
				routeVersion: 3
			};
			let client = new JsonRPCApiClient(settings, options);
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
			let settings = {
				server: DEFAULT_JSON_RPC_SERVER,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD
			};
			let client = new JsonRPCApiClient(settings);
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

	// NOTE: #authenticate() is called from the constructor
	describe('#authenticate', function() {

		before(function(done) {
			let { app, router } = getApi();
			this.router = router;
			this.server = app.listen(AUTH_PORT, done);
		});

		after(function() {
			this.server.close();
		});

		it('sends a request to auth.password w/ a username and password', function() {
			let waiter = pasync.waiter();
			this.router.register({ method: 'auth.password' }, (ctx) => {
				try {
					expect(ctx.params.ns).to.equal('zs');
					expect(ctx.params.username).to.equal(DEFAULT_USERNAME);
					expect(ctx.params.password).to.equal(DEFAULT_PASSWORD);
					waiter.resolve();
				} catch (err) {
					waiter.reject(err);
				}
			});

			let settings = {
				server: DEFAULT_JSON_RPC_SERVER,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD
			};
			let options = {
				authServer: DEFAULT_AUTH_SERVER,
				routeVersion: DEFAULT_ROUTE_VERSION
			};
			let client = new JsonRPCApiClient(settings, options);

			return waiter.promise;
		});

		it('sends a request to auth.refresh w/ a refresh token', function() {
			let waiter = pasync.waiter();
			this.router.register({ method: 'auth.refresh' }, (ctx) => {
				try {
					expect(ctx.params.refreshToken).to.equal(DEFAULT_REFRESH_TOKEN);
					waiter.resolve();
				} catch (err) {
					waiter.reject(err);
				}
			});

			let settings = {
				server: DEFAULT_JSON_RPC_SERVER,
				refreshToken: DEFAULT_REFRESH_TOKEN
			};
			let options = {
				authServer: DEFAULT_AUTH_SERVER,
				routeVersion: DEFAULT_ROUTE_VERSION
			};
			let client = new JsonRPCApiClient(settings, options);

			return client.authWaiter.promise;
		});

	});

	describe('#getUrl', function() {

		before(function() {
			let settings = {
				server: DEFAULT_JSON_RPC_SERVER,
				accessToken: DEFAULT_ACCESS_TOKEN
			};
			let options = {
				authServer: DEFAULT_AUTH_SERVER,
				routeVersion: DEFAULT_ROUTE_VERSION
			};
			this.client = new JsonRPCApiClient(settings, options);
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

});

function getApi() {
	let app = express();
	let router = new APIRouter();
	let jsonRpcInterface = new JSONRPCInterface({ includeErrorStack: true });
	router.version(DEFAULT_ROUTE_VERSION).addInterface(jsonRpcInterface);
	app.use(router.getExpressRouter());
	return { app, router };
}
