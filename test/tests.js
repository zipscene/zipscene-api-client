let expect = require('chai').expect;
const XError = require('xerror');
let JsonRPCApiClient = require('../lib/jsonrpc-api-client');

let DEFAULT_SERVER = 'http://localhost:3000';
let DEFAULT_AUTH_SERVER = 'http://localhost:3001';
let DEFAULT_USERNAME = 'admin';
let DEFAULT_PASSWORD = '1234';
let DEFAULT_ACCESS_TOKEN = 'accessToken1234';
let DEFAULT_REFRESH_TOKEN = 'refreshToken1234';

describe('JsonRPCApiClient', function() {

	describe('#constructor', function() {
		it('should set all the settings and options given', function(done) {
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
			done();
		});

		it('should throw an error if server is not set', function(done) {
			expect( () => {
				new JsonRPCApiClient({});
			}).to.throw(XError.INVALID_ARGUMENT, 'Server must be set to make a request');
			done();
		});

		it('should throw an error if no authentication is set', function(done) {
			expect( () => {
				new JsonRPCApiClient({ server: DEFAULT_SERVER });
			}).to.throw(
				XError.INVALID_ARGUMENT,
				'Settings must set username and password or authToken or refreshToken');
			done();
		});

		it('should not throw an error when only auth is username and password', function(done) {
			let settings = {
				server: DEFAULT_SERVER,
				username: DEFAULT_USERNAME,
				password: DEFAULT_PASSWORD
			};
			let client = new JsonRPCApiClient(settings);
			expect(client.server).to.equal(DEFAULT_SERVER);
			expect(client.username).to.equal(DEFAULT_USERNAME);
			expect(client.password).to.equal(DEFAULT_PASSWORD);
			expect(client.accessToken).to.equal(undefined);
			expect(client.refreshToken).to.equal(undefined);
			expect(client.authServer).to.equal(DEFAULT_SERVER);
			expect(client.routeVersion).to.equal(2);
			done();
		});

		it('should not throw an error when only accessToken is set', function(done) {
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
			done();
		});

		it('should not throw an error when only refreshToken is set', function(done) {
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
			done();
		});
	});

});


