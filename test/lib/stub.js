const sinon = require('sinon');
const XError = require('xerror');
XError.registerErrorCode('bad_access_token', { message: 'The access token expired' });

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
			() => {
				return Promise.reject(new XError(XError.BAD_ACCESS_TOKEN));
			})
		);
	}

	resolveLoginRequest(client, accessToken) {
		return this.addStub(sinon.stub(
			client,
			'_loginRequest',
			() => {
				client.accessToken = accessToken;
				return Promise.resolve();
			})
		);
	}

	rejectLoginRequest(client) {
		return this.addStub(sinon.stub(
			client,
			'_loginRequest',
			() => {
				return Promise.reject(new XError(XError.INTERNAL_ERROR));
			})
		);
	}

	restoreAll() {
		for (let stub of this.stubs) {
			stub.restore();
		}
	}
}

module.exports = Stub;
