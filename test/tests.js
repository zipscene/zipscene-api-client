const expect = require('chai').expect;
const XError = require('xerror');
const JsonRPCApiClient = require('../lib/jsonrpc-api-client');

const DEFAULT_SERVER = 'http://localhost:3000';
const DEFAULT_AUTH_SERVER = 'http://localhost:3001';
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = '1234';
const DEFAULT_ACCESS_TOKEN = 'accessToken1234';
const DEFAULT_REFRESH_TOKEN = 'refreshToken1234';

describe('JsonRPCApiClient', function() {

	describe('#constructor', function() {
		it('should set all the settings and options given', function() {
			let settings = {
				server: DEFAULT_SERVER,
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
			expect(client.server).to.equal(DEFAULT_SERVER);
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
			expect(() => new JsonRPCApiClient({ server: DEFAULT_SERVER }))
				.to.throw(XError.INVALID_ARGUMENT, expectedMsg);
		});

		it('should not throw an error when only auth is username and password', function() {
			let settings = {
				server: DEFAULT_SERVER,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD
			};
			let client = new JsonRPCApiClient(settings);
			expect(client.server).to.equal(DEFAULT_SERVER);
			expect(client.username).to.equal(DEFAULT_USERNAME);
			expect(client.password).to.equal(DEFAULT_PASSWORD);
			expect(client.accessToken).to.be.undefined;
			expect(client.refreshToken).to.be.undefined;
			expect(client.authServer).to.equal(DEFAULT_SERVER);
			expect(client.routeVersion).to.equal(2);
		});

		it('should not throw an error when only accessToken is set', function() {
			let settings = {
				server: DEFAULT_SERVER,
				accessToken: DEFAULT_ACCESS_TOKEN
			};
			let client = new JsonRPCApiClient(settings);
			expect(client.server).to.equal(DEFAULT_SERVER);
			expect(client.username).to.equal(undefined);
			expect(client.password).to.equal(undefined);
			expect(client.accessToken).to.equal(DEFAULT_ACCESS_TOKEN);
			expect(client.refreshToken).to.equal(undefined);
			expect(client.authServer).to.equal(DEFAULT_SERVER);
			expect(client.routeVersion).to.equal(2);
		});

		it('should not throw an error when only refreshToken is set', function() {
			let settings = {
				server: DEFAULT_SERVER,
				refreshToken: DEFAULT_REFRESH_TOKEN
			};
			let client = new JsonRPCApiClient(settings);
			expect(client.server).to.equal(DEFAULT_SERVER);
			expect(client.username).to.equal(undefined);
			expect(client.password).to.equal(undefined);
			expect(client.accessToken).to.equal(undefined);
			expect(client.refreshToken).to.equal(DEFAULT_REFRESH_TOKEN);
			expect(client.authServer).to.equal(DEFAULT_SERVER);
			expect(client.routeVersion).to.equal(2);
		});
	});

});
