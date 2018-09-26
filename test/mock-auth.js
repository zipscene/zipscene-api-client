const XError = require('xerror');
const express = require('express');
const bodyParser = require('body-parser');

const PORT = 14142;
const GOOD_TOKEN = '$an$access$token';
const EXPIRED_TOKEN = '$an$expired$token';
const BAD_PASSWORD = 'badpassword';

class MockAuthService {

	constructor() {
		// Nothing
	}

	start() {
		this.app = express();
		this.app.use(bodyParser.json());

		this.app.post('/v1/jsonrpc', (req, res) => {
			if (req.body.method !== 'login') {
				return res.json({ error: { code: 'internal_error' } });
			}
			if (req.body.params.password === BAD_PASSWORD) {
				return res.json({ error: { code: 'authentication_error' } });
			}
			return res.json({ result: { accessToken: GOOD_TOKEN } });
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
MockAuthService.URL = `http://localhost:${PORT}`;
MockAuthService.GOOD_TOKEN = GOOD_TOKEN;
MockAuthService.EXPIRED_TOKEN = EXPIRED_TOKEN;
MockAuthService.BAD_PASSWORD = BAD_PASSWORD;

module.exports = MockAuthService;