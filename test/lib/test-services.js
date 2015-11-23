const fs = require('fs');
const path = require('path');
const promisify = require('es6-promisify');
const uuid = require('uuid');
const { MongoClient } = require('mongodb-promise');
const { Promise } = require('es6-promise');
const { spawn } = require('child_process');

const adminUser = require('./admin-user');

const promiseWriteFile = promisify(fs.writeFile);
const promiseUnlink = promisify(fs.unlink);

module.exports = class TestServices {

	constructor() {
		this.testDb = `test-${ uuid.v4() }`;
		this.mongoUri = `mongodb://127.0.0.1/${ this.testDb }?auto_reconnect`;
	}

	setUpServices(verbose = false) {
		return this.setUpMongo()
			.then(() => this.startZsApi(verbose));
	}

	tearDownServices(zsApiProcess) {
		return this.zsApiProcess.kill() && this.db.dropDatabase();
	}

	setUpMongo() {
		return MongoClient.connect(this.mongoUri)
			.then((db) => this.db = db)
			.then(() => this.db.collection('users'))
			.then((users) => users.insert(adminUser));
	}

	startZsApi(verbose) {
		return new Promise((resolve, reject) => {
			let options = {
				cwd: path.resolve(__dirname, '../../../node_modules/zsapi'),
				env: {
					MONGODB_URI: `mongodb://127.0.0.1/${ this.testDb }?auto_reconnect`,
					NODE_ENV: 'test',
					PORT: 3333
				},
				stdio: 'pipe'
			};
			try {
				this.zsApiProcess = spawn(process.execPath, [ 'app.js' ], options);
				this.zsApiProcess.stdout.on('data', (msg) => {
					msg = msg.toString();
					if (verbose) { console.log(msg); }
					if (/Listening on \d+.\d+.\d+.\d+ port \d{4}/.test(msg)) {
						return resolve(this.zsApiProcess);
					}
				});
			} catch (err) {
				console.dir(err);
				this.zsApiProcess && this.zsApiProcess.kill();
				return reject(err);
			}
		});
	}

};
