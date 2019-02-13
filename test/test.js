const XError = require('xerror');
const objtools = require('objtools');
const { expect } = require('chai');
const pasync = require('pasync');
const MockAuth = require('./mock-auth');
const MockDmp = require('./mock-dmp');
const ZipsceneRPCClient = require('../lib/zipscene-rpc-client');

const DEFAULT_CONFIG = {
	server: MockDmp.URL,
	authServer: MockAuth.URL,
	email: 'admin@admin.com',
	password: 'abc123'
};

describe('ZipsceneRPCClient', () => {

	// Set up mock auth service and dmp
	let mockAuth, mockDmp;
	before(() => {
		mockAuth = new MockAuth();
		return mockAuth.start()
			.then(() => {
				mockDmp = new MockDmp();
				return mockDmp.start();
			});
	});

	after(() => {
		if (mockAuth) mockAuth.stop();
		if (mockDmp) mockDmp.stop();
	});

	it('should fail to create client with no credentials', () => {
		let opts = objtools.merge({}, DEFAULT_CONFIG, { email: null, password: null });
		expect(() => { return new ZipsceneRPCClient(opts); }).to.throw(XError);
	});

	it('should authenticate with given credentials', () => {
		let client = new ZipsceneRPCClient(DEFAULT_CONFIG);
		return client.request('check-token')
			.then((result) => {
				expect(result.success).to.equal(true);
			});
	});

	it('should fail to authenticate with invalid credentials', () => {
		let client = new ZipsceneRPCClient(objtools.merge(
			{},
			DEFAULT_CONFIG,
			{ password: MockAuth.BAD_PASSWORD }
		));
		return client.request('check-token')
			.then(() => {
				throw new Error('Shouldnt be here');
			})
			.catch((err) => {
				expect(err.code).to.equal('authentication_error');
			});
	});

	it('should authenticate with given access token', () => {
		let client = new ZipsceneRPCClient(objtools.merge(
			{},
			DEFAULT_CONFIG,
			{ email: null, password: null, accessToken: MockAuth.GOOD_TOKEN }
		));
		return client.request('check-token')
			.then((result) => {
				expect(result.success).to.equal(true);
			});
	});

	it('should fail to authenticate with bad provided access token', () => {
		let client = new ZipsceneRPCClient(objtools.merge(
			{},
			DEFAULT_CONFIG,
			{ email: null, password: null, accessToken: '$junk$token' }
		));
		return client.request('check-token')
			.then(() => {
				throw new Error('Shouldnt be here');
			})
			.catch((err) => {
				expect(err.code).to.equal('bad_access_token');
			});
	});

	it('should rethrow token_expired error if access token was provided', () => {
		let client = new ZipsceneRPCClient(objtools.merge(
			{},
			DEFAULT_CONFIG,
			{ email: null, password: null, accessToken: MockAuth.EXPIRED_TOKEN }
		));
		return client.request('check-token')
			.then(() => {
				throw new Error('Shouldnt be here');
			})
			.catch((err) => {
				expect(err.code).to.equal('token_expired');
			});
	});

	it('should allow client creation with no credentials if noAuth is set', () => {
		let client = new ZipsceneRPCClient(objtools.merge(
			{},
			DEFAULT_CONFIG,
			{ email: null, password: null, noAuth: true }
		));
		return client.request('pass')
			.then((result) => {
				expect(result.success).to.equal(true);
			});
	});


	it('should return the result of a basic request', () => {
		let client = new ZipsceneRPCClient(DEFAULT_CONFIG);
		return client.request('times-two-not-three', { number: 8 })
			.then((result) => {
				expect(result.number).to.equal(16);
			});
	});

	it('should throw the error returned by the remote server', () => {
		let client = new ZipsceneRPCClient(DEFAULT_CONFIG);
		return client.request('times-two-not-three', { number: 3 })
			.then((result) => {
				throw new Error('Shouldnt be here');
			})
			.catch((err) => {
				expect(err.code).to.equal('invalid_argument');
			});
	});

	it('should support automatic retries', () => {
		let client = new ZipsceneRPCClient(DEFAULT_CONFIG);
		return client.request('toggle', {}, { maxRetries: 2 })
			.catch(() => {
				throw new Error('Shouldnt be here');
			})
			.then((result) => {
				expect(result.success).to.equal(true);

				return client.request('toggle', { maxRetries: 1 });
			})
			.then(() => {
				throw new Error('Shouldnt be here');
			})
			.catch((err) => {
				expect(err.code).to.equal('internal_error');
			});
	});

	it('should re-authenticate if access token is expired', () => {
		let client = new ZipsceneRPCClient(DEFAULT_CONFIG);
		return client.request('pass')
			.then(() => {
				// Stub in expired token
				client.accessToken = MockAuth.EXPIRED_TOKEN;
				return client.request('pass');
			})
			.then((result) => {
				expect(result.success).to.equal(true);
			});
	});


	it('should consume a streaming response', () => {
		let client = new ZipsceneRPCClient(DEFAULT_CONFIG);
		let results = [];
		return client.requestStream('stream')
			.through((data) => {
				results.push(data.number);
			})
			.intoPromise()
			.then(() => {
				expect(results).to.deep.equal([ 0, 1, 2 ]);
			});
	});

	it('should fail if stream hangs up with a success object', () => {
		let client = new ZipsceneRPCClient(DEFAULT_CONFIG);
		let results = [];
		return client.requestStream('stream', { truncate: true })
			.through((data) => {
				results.push(data.number);
			})
			.intoPromise()
			.then(() => {
				throw new Error('Shouldnt be here');
			})
			.catch((err) => {
				expect(err.code).to.equal('api_client_error');
			});
	});

	it('should throw an error returned within a streaming response', () => {
		let client = new ZipsceneRPCClient(DEFAULT_CONFIG);
		let results = [];
		return client.requestStream('stream-error')
			.through((data) => {
				results.push(data.number);
			})
			.intoPromise()
			.then(() => {
				throw new Error('Shouldnt be here');
			})
			.catch((err) => {
				expect(err.code).to.equal('internal_error');
			});
	});

	it('should reauthenticate if access token is expired during streaming request', () => {
		let client = new ZipsceneRPCClient(DEFAULT_CONFIG);
		let results = [];
		return client.request('pass')
			.then(() => {
				// Stub in expired token
				client.accessToken = MockAuth.EXPIRED_TOKEN;
				return client.requestStream('stream')
					.through((data) => {
						results.push(data.number);
					})
					.intoPromise();
			})
			.then((result) => {
				expect(results).to.deep.equal([ 0, 1, 2 ]);
			});
	});

});
