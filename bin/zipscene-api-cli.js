const objtools = require('objtools');
const fs = require('fs');
const yaml = require('js-yaml');
const passwordPrompt = require('password-prompt');
const clientlib = require('../lib');

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
	.option('verbose', {
		alias: 'v',
		description: 'Verbose flag',
		type: 'boolean',
		global: true
	})
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
			});
	}, wrapCommand(commandRPC));

// Auth command
yargs = yargs
	.command('auth', 'Authenticate and get access token', {}, wrapCommand(commandAuth));

// API Info command
yargs = yargs
	.command([ 'api-info', 'info' ], 'Get API info data', (yargs) => {
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
			.option('all', {
				alias: 'a',
				description: 'Show full API info JSON',
				nargs: 0
			})
			.option('listmethods', {
				alias: 'l',
				description: 'List RPC methods',
				nargs: 0
			})
			.option('method', {
				alias: 'm',
				description: 'Show method info',
				nargs: 1,
				requiresArg: true,
				type: 'string'
			})
			.option('listmodels', {
				description: 'List model schemas',
				nargs: 0
			})
			.option('model', {
				description: 'Show model schema',
				nargs: 1,
				requiresArg: true,
				type: 'string'
			})
			.check((argv) => {
				if (!argv.all && !argv.listmethods && !argv.method && !argv.listmodels && !argv.model) {
					throw new Error('No options provided');
				}
				return true;
			});
	}, wrapCommand(commandAPIInfo));

// Data client commands
const yargsDCOptions = {
	profileType: (yargs) => yargs.option('profile-type', {
		alias: 'p',
		description: 'Profile type to query',
		nargs: 1,
		requiresArg: true,
		type: 'string',
		demandOption: true
	}),
	query: (yargs) => yargs.option('query', {
		alias: 'q',
		description: 'JSON/YAML query to run',
		nargs: 1,
		requiresArg: true,
		type: 'string'
	}).option('query-file', {
		alias: 'qfile',
		description: 'JSON/YAML query to run from file',
		nargs: 1,
		requiresArg: true,
		type: 'string'
	})
	.check((argv) => {
		if (!argv.query && !argv['query-file']) {
			throw new Error('No query supplied');
		}
		return true;
	}),
	fields: (yargs) => yargs.option('fields', {
		alias: 'f',
		description: 'Fields to return (specify option multiple times)',
		type: 'array'
	}),
	sort: (yargs) => yargs.option('sort', {
		alias: 's',
		description: 'Fields to sort by; prefix field with / or ! to reverse',
		type: 'array'
	}),
	limit: (yargs) => yargs.option('limit', {
		alias: 'l',
		description: 'Max number of results to return',
		nargs: 1,
		requiresArg: true,
		type: 'number'
	}),
	timeout: (yargs) => yargs.option('timeout', {
		alias: 't',
		description: 'Maximum query run time (seconds)',
		nargs: 1,
		requiresArg: true,
		type: 'number'
	})
};
yargs = yargs
	.command([ 'query', 'q' ], 'Execute DMP query', (yargs) => {
		yargs = yargsDCOptions.profileType(yargs);
		yargs = yargsDCOptions.query(yargs);
		yargs = yargsDCOptions.fields(yargs);
		yargs = yargsDCOptions.sort(yargs);
		yargs = yargsDCOptions.limit(yargs);
		yargs = yargs.option('skip', {
			description: null,
			nargs: 1,
			requiresArg: true,
			type: 'number'
		});
		yargs = yargsDCOptions.timeout(yargs);
		return yargs;
	}, wrapCommand(commandQuery))
	.command('get', 'Fetch DMP object', (yargs) => {
		yargs = yargsDCOptions.profileType(yargs);
		yargs = yargs.option('id', {
			alias: 'i',
			description: 'ID of object to get',
			nargs: 1,
			requiresArg: true,
			type: 'string',
			demandOption: true
		});
		yargs = yargsDCOptions.fields(yargs);
		yargs = yargsDCOptions.timeout(yargs);
		return yargs;
	}, wrapCommand(commandGet))
	.command('count', 'Execute DMP count', (yargs) => {
		yargs = yargsDCOptions.profileType(yargs);
		yargs = yargsDCOptions.query(yargs);
		yargs = yargsDCOptions.timeout(yargs);
		return yargs;
	}, wrapCommand(commandCount))
	.command([ 'aggregate', 'agg' ], 'Execute DMP aggregate', (yargs) => {
		yargs = yargsDCOptions.profileType(yargs);
		yargs = yargsDCOptions.query(yargs);
		yargs = yargs.option('aggregate', {
			alias: 'a',
			description: 'JSON/YAML aggregate spec, or array of specs',
			nargs: 1,
			requiresArg: true,
			type: 'string'
		}).option('aggregate-file', {
			alias: 'afile',
			description: 'Load aggregate spec(s) from file',
			nargs: 1,
			requiresArg: true,
			type: 'string'
		}).check((argv) => {
			if (!argv.aggregate && !argv['aggregate-file']) {
				throw new Error('No aggregate spec supplied');
			}
			return true;
		});
		yargs = yargsDCOptions.sort(yargs);
		yargs = yargsDCOptions.limit(yargs);
		yargs = yargs.option('scan-limit', {
			description: 'Maximum number of documents to process with the aggregate',
			nargs: 1,
			requiresArg: true,
			type: 'number'
		});
		yargs = yargsDCOptions.timeout(yargs);
		return yargs;
	}, wrapCommand(commandAggregate))
	.command('export', 'Export large queries from DMP', (yargs) => {
		yargs = yargsDCOptions.profileType(yargs);
		yargs = yargsDCOptions.query(yargs);
		yargs = yargsDCOptions.fields(yargs);
		yargs = yargsDCOptions.sort(yargs);
		yargs = yargsDCOptions.limit(yargs);
		yargs = yargs.option('export-strategy', {
			alias: [ 'strategy' ],
			description: 'Which methodology to use to export data',
			nargs: 1,
			requiresArg: true,
			type: 'string',
			choices: [ 'stream', 'file' ]
		});
		yargs = yargsDCOptions.timeout(yargs);
		return yargs;
	}, wrapCommand(commandExport));


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
	if (typeof data === 'string') {
		console.log(data);
	} else if (argv.pretty) {
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
	return await clientlib.getRPCClient(service, argv, config);
}

function getAuxAPIClient(argv, dmpApiClient, auxService) {
	return clientlib.getAuxRPCClient(auxService, dmpApiClient, argv, config);
}

async function getDataClient(argv) {
	return await clientlib.getDataClient(argv['profile-type'], argv, config);
}


async function commandRPC(argv) {
	let client = await getAPIClient(argv, argv.service || config.defaultService);
	let params = loadParseObject(argv.params, argv['params-file']);
	let result = await client.request(argv.method, params);
	displayOutput(argv, result);
}

async function commandAuth(argv) {
	let client = await getAPIClient(argv, config.defaultService);
	let accessToken = await client.authenticate();
	if (argv.pretty) {
		displayOutput(argv, 'Access token: ' + accessToken);
		let authHeader = 'Authorization: Bearer ' + Buffer.from(accessToken).toString('base64');
		displayOutput(argv, authHeader);
	} else {
		displayOutput(argv, accessToken);
	}
}

async function commandAPIInfo(argv) {
	let client = await getAPIClient(argv, argv.service || config.defaultService);
	let info = await client.request('api-info', {});
	if (argv.all) {
		displayOutput(argv, info);
	}
	if (argv.listmethods) {
		for (let method in info.methods) {
			displayOutput(argv, method + (info.methods[method].description ? (' - ' + info.methods[method].description) : ''));
		}
	}
	if (argv.method) {
		if (!info.methods[argv.method]) throw new Error('No such method');
		displayOutput(argv, info.methods[argv.method]);
	}
	if (argv.listmodels) {
		for (let model in info.models) {
			displayOutput(argv, model + (info.models[model].description ? (' - ' + info.models[model].description) : ''));
		}
	}
	if (argv.model) {
		if (!info.models[argv.model]) throw new Error('No such model');
		displayOutput(argv, info.models[argv.model]);
	}
}

function parseSort(sortArg) {
	let sort = sortArg ? (Array.isArray(sortArg) ? sortArg : [ sortArg ]) : undefined;
	if (Array.isArray(sort)) {
		return sort.map((s) => {
			if (s[0] === '/' || s[0] === '!') {
				return '-' + s.slice(1);
			} else {
				return s;
			}
		});
	} else {
		return sort;
	}
}

async function commandQuery(argv) {
	let dataClient = await getDataClient(argv);
	let query = loadParseObject(argv.query, argv['query-file']);
	let fields = argv.fields ? (Array.isArray(argv.fields) ? argv.fields : [ argv.fields ]) : undefined;
	let sort = parseSort(argv.sort);
	let results = await dataClient.query(query, {
		fields,
		sort,
		limit: argv.limit,
		skip: argv.skip,
		timeout: argv.timeout
	});
	displayOutput(argv, results);
}

async function commandGet(argv) {
	let dataClient = await getDataClient(argv);
	let fields = argv.fields ? (Array.isArray(argv.fields) ? argv.fields : [ argv.fields ]) : undefined;
	let result = await dataClient.get(argv.id, {
		fields,
		timeout: argv.timeout
	});
	displayOutput(argv, result);
}

async function commandCount(argv) {
	let dataClient = await getDataClient(argv);
	let query = loadParseObject(argv.query, argv['query-file']);
	let results = await dataClient.count(query, {
		timeout: argv.timeout
	});
	displayOutput(argv, results);
}

async function commandAggregate(argv) {
	let dataClient = await getDataClient(argv);
	let query = loadParseObject(argv.query, argv['query-file']);
	let aggregate = loadParseObject(argv.aggregate, argv['aggregate-file']);
	let sort = parseSort(argv.sort);
	let results = await dataClient.aggregate(query, aggregate, {
		sort,
		limit: argv.limit,
		scanLimit: argv['scan-limit'],
		timeout: argv.timeout
	});
	displayOutput(argv, results);
}

async function commandExport(argv) {
	let dataClient = await getDataClient(argv);
	let query = loadParseObject(argv.query, argv['query-file']);
	let fields = argv.fields ? (Array.isArray(argv.fields) ? argv.fields : [ argv.fields ]) : undefined;
	let sort = parseSort(argv.sort);
	let strategy = argv['export-strategy'];
	resultStream = dataClient.export(query, {
		strategy,
		fields,
		sort,
		limit: argv.limit,
		timeout: argv.timeout
	});
	await resultStream
		.each((obj) => {
			console.log(JSON.stringify(obj));
		})
		.intoPromise();
}

