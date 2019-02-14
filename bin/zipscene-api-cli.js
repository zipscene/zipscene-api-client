const objtools = require('objtools');
const fs = require('fs');
const yaml = require('js-yaml');
const passwordPrompt = require('password-prompt');
const ZipsceneRPCClient = require('../lib/zipscene-rpc-client');

// If run with node binary, strip out the first 2 args
let slicedArgv = process.argv;
if (slicedArgv[0] === '/usr/bin/node') slicedArgv = slicedArgv.slice(2);

// Pre-parse the argv to find if an alternate config file was specified (the config file can affect parsing)
const argvPreParse = require('yargs')
	.option('config')
	.option('config-env')
	.help(false)
	.strict(false)
	.parse(slicedArgv);

// Load the config
const config = require('littleconf').getConfig({
	argv: argvPreParse,
	cliArgumentFile: 'config',
	cliArgumentEnvironment: 'config-env'
});

// Build the argument parser
let yargs = require('yargs');

// General options
yargs = yargs
	.help('help')
	.strict(true)
	.demandCommand(1, 1);

// Config options
yargs = yargs
	.option('config', {
		description: 'Path to config file',
		group: 'Configuration:',
		nargs: 1,
		requiresArg: true,
		type: 'string'
	})
	.option('config-env', {
		description: 'Config file environment',
		group: 'Configuration:',
		nargs: 1,
		requiresArg: true,
		type: 'string'
	});

// Authentication options
yargs = yargs
	.option('auth-server', {
		demandOption: !objtools.getPath(config, 'auth.server'),
		description: 'URL for auth server used for authentication',
		global: true,
		group: 'Authentication:',
		nargs: 1,
		requiresArg: true,
		type: 'string'
	})
	.option('username', {
		alias: 'email',
		description: 'Username/email to authenticate with',
		global: true,
		group: 'Authentication:',
		nargs: 1,
		requiresArg: true,
		type: 'string',
		conflicts: 'auth-token'
	})
	.option('password', {
		description: 'Password to authenticate with, prompted if not specified',
		global: true,
		group: 'Authentication:',
		nargs: 1,
		requiresArg: true,
		type: 'string',
		conflicts: 'auth-token'
	})
	.option('access-token', {
		description: 'Auth token to authenticate with',
		global: true,
		group: 'Authentication:',
		nargs: 1,
		requiresArg: true,
		type: 'string',
		conflicts: [ 'username', 'password' ]
	})
	.check((argv) => {
		// Ensure adequate authentication info is present
		if (!objtools.getPath(config, 'auth.accessToken') && !objtools.getPath(config, 'auth.username') && !argv['access-token'] && !argv.username) {
			throw new Error('You must specify a username or access token, as CLI options or in the config.');
		}
		return true;
	});

// Other options
yargs = yargs
	.option('pretty', {
		description: 'Pretty-print output',
		type: 'boolean',
		default: true,
		global: true
	})
	.option('server', {
		description: 'Override API server to connect to',
		nargs: 1,
		requiresArg: true,
		type: 'string',
		global: true
	});

// RPC command
yargs = yargs
	.command('rpc', 'Run RPC API call', (yargs) => {
		return yargs
			.option('service', {
				alias: 's',
				description: 'Service to connect to',
				nargs: 1,
				requiresArg: true,
				type: 'string',
				default: config.defaultService,
				choices: Object.keys(config.services)
			})
			.option('method', {
				alias: 'm',
				description: 'RPC method to call',
				nargs: 1,
				requiresArg: true,
				type: 'string',
				demandOption: true
			})
			.option('params', {
				alias: 'p',
				description: 'Parameters for the RPC call, as a JSON or YAML object',
				nargs: 1,
				requiresArg: true,
				type: 'string'
			})
			.option('params-file', {
				alias: 'pfile',
				description: 'Load parameters from a file',
				nargs: 1,
				requiresArg: true,
				type: 'string'
			})
			.option('pretty', {
				description: 'Pretty-print JSON',
				type: 'boolean',
				default: true
			});
	}, wrapCommand(commandRPC));

// Parse arguments & execute specified commands
yargs.parse(slicedArgv);

function wrapCommand(fn) {
	return async function(argv) {
		try {
			await fn(argv);
		} catch (err) {
			displayError(argv, err);
		}
	};
}

function displayOutput(argv, data) {
	if (argv.pretty) {
		console.log(JSON.stringify(data, null, 2));
	} else {
		console.log(JSON.stringify(data));
	}
}

function displayError(argv, err) {
	if (err instanceof Error) {
		console.error(err.toString());
		//console.error(err.stack);
	} else if (typeof err === 'string') {
		console.error(err);
	} else if (argv.pretty) {
		console.error(JSON.stringify(err, null, 2));
	} else {
		console.error(JSON.stringify(err));
	}
}

// Loads and parses an object from either the given string or the given filename
function loadParseObject(objString, objFilename) {
	let obj = {};
	if (objString) {
		let d = yaml.safeLoad(objString, 'utf8');
		if (typeof d !== 'object' || !d) throw new Error('Invalid JSON/YAML object');
		objtools.merge(obj, d);
	}
	if (objFilename) {
		let str = fs.readFileSync(objFilename);
		let d = yaml.safeLoad(str, 'utf8');
		if (typeof d !== 'object' || !d) throw new Error('Invalid JSON/YAML object');
		objtools.merge(obj, d);
	}
	return obj;
}

async function getAPIClient(argv, service = 'dmp') {
	let serviceConfig = config.services[service];
	if (!serviceConfig) throw new Error('Service not found');

	let server = argv.server || serviceConfig.server;
	let authServer = argv['auth-server'] || config.auth.server;
	let serverOptions = {
		server,
		authServer,
		routeVersion: serviceConfig.routeVersion
	};

	let authOptions = {};
	if (argv['access-token']) {
		authOptions.accessToken = argv['access-token'];
	} else if (argv.username || config.auth.username) {
		authOptions.email = argv.username || config.auth.username;
		if (argv.password) {
			authOptions.password = argv.password;
		} else if (config.auth.password) {
			authOptions.password = config.auth.password;
		} else {
			authOptions.password = await passwordPrompt(`Password for ${authOptions.email}: `, { method: 'hide' });
		}
	} else if (config.auth.accessToken) {
		authOptions.accessToken = config.auth.accessToken;
	} else {
		throw new Error('Must supply either an access token or username');
	}
	let options = objtools.merge({}, serverOptions, authOptions);
	console.log('API client options', options);
	return new ZipsceneRPCClient(options);
}


async function commandRPC(argv) {
	let client = await getAPIClient(argv, argv.service || config.defaultService);
	let params = loadParseObject(argv.params, argv['params-file']);
	console.log('Doing request', argv.method, params);
	let result = await client.request(argv.method, params);
	displayOutput(argv, result);
}


