const XError = require('xerror');
const express = require('express');
const bodyParser = require('body-parser');
const MockAuth = require('./mock-auth');

const EXPIRED_TOKEN_HEADER = `Bearer ${ new Buffer(MockAuth.EXPIRED_TOKEN).toString('base64') }`;
const GOOD_TOKEN_HEADER = `Bearer ${ new Buffer(MockAuth.GOOD_TOKEN).toString('base64') }`;

const PORT = 14141;

class MockDmp {

	constructor() {
		// Nothing
	}

	start() {
		this.app = express();
		this.app.use(bodyParser.json());
		this.app.use((req, res, next) => {
			if (req.headers.authorization === EXPIRED_TOKEN_HEADER) {
				return res.json({ error: { code: 'token_expired' } });
			}
			next();
		});

		this.app.post('/v2/jsonrpc', (req, res) => {
			if (req.body.method === 'times-two-not-three') {
				let number = req.body.params.number;
				if (number === 3) {
					return res.json({ error: { code: 'invalid_argument' } });
				}
				return res.json({ result: { number: number * 2 } });
			} else if (req.body.method === 'pass') {
				return res.json({ result: { success: true } });
			} else if (req.body.method === 'check-token') {
				if (req.headers.authorization === GOOD_TOKEN_HEADER) {
					return res.json({ result: { success: true } });
				}
				return res.json({ error: { code: 'bad_access_token' } });
			} else if (req.body.method === 'toggle') {
				// Switch between success and failure (for testing retry)
				if (this.toggle) {
					this.toggle = false;
					return res.json({ result: { success: true } });
				} else {
					this.toggle = true;
					return res.json({ error: { code: 'internal_error' } });
				}

			} else if (req.body.method === 'stream') {
				let lines = [];
				for (let i = 0; i < 3; i++) {
					lines.push(JSON.stringify({ number: i }));
				}
				lines.push(JSON.stringify({ success: true }));
				if (req.body.params && req.body.params.truncate) {
					lines = lines.slice(0, 2);
				}
				return res.send(lines.join('\n'));
			} else if (req.body.method === 'stream-error') {
				let lines = [
					JSON.stringify({ error: { code: 'internal_error' } })
				];
				return res.send(lines.join('\n'));
			} else {
				// Missing method
				return res.json({ error: { code: 'internal_error' } });
			}
		});

		return new Promise((resolve, reject) => {
			this.server = this.app.listen(PORT, (err) => {
				if (err) return reject(err);
				resolve();
			});
		});
	}

	stop() {
		if (this.server) this.server.close();
	}
}
MockDmp.URL = `http://localhost:${PORT}`;

module.exports = MockDmp;