const sinon = require('sinon');
const XError = require('xerror');
const requestPromise = require('request-promise');
// XError.registerErrorCode('bad_access_token', { message: 'The access token expired' });

class Stub {
	constructor() {
		this.stubs = [];
	}

	addStub(stub) {
		this.stubs.push(stub);
		return stub;
	}

	resolveRefreshRequest(client, accessToken) {
		return this.addStub(sinon.stub(
			client,
			'_refreshRequest',
			() => {
				client.accessToken = accessToken;
				return Promise.resolve();
			})
		);
	}

	rejectRefreshRequest(client) {
		return this.addStub(sinon.stub(
			client,
			'_refreshRequest',
			() => Promise.reject(new XError(XError.BAD_ACCESS_TOKEN)))
		);
	}

	resolveLoginRequest(client, accessToken) {
		return this.addStub(sinon.stub(
			client,
			'_legacyLoginRequest',
			() => {
				client.accessToken = accessToken;
				return Promise.resolve();
			})
		);
	}

	rejectLoginRequest(client) {
		return this.addStub(sinon.stub(
			client,
			'_legacyLoginRequest',
			() => Promise.reject(new XError(XError.INTERNAL_ERROR)))
		);
	}

	rejectRequest() {
		return this.addStub(sinon.stub(
			requestPromise,
			'Request',
			() => Promise.reject(new Error('Error on request')))
		);
	}

	resolveErrorRequest(id) {
		let error = new XError(XError.INTERNAL_ERROR);
		return this.addStub(sinon.stub(
			requestPromise,
			'Request',
			() => Promise.resolve({ error, id, result: null })
			)
		);
	}

	resolveResultRequest(id) {
		let result = { success: true };
		return this.addStub(sinon.stub(
			requestPromise,
			'Request',
			() => Promise.resolve({ error: null, id, result })
			)
		);
	}

	restoreAll() {
		for (let stub of this.stubs) {
			stub.restore();
		}
	}
}

module.exports = Stub;
