const ZipsceneRPCClient = require('./zipscene-rpc-client');
const ZipsceneDataClient = require('./zipscene-data-client');
const passwordPrompt = require('password-prompt');
const objtools = require('objtools');
const path = require('path');

// Intentionally load config for zipscene-api-client, even if this is used from
// a different library.
let projectConfig = require('littleconf').getConfig({
	rootDir: path.resolve(__dirname, '..'),
	projectName: 'zipscene-api-client'
});

async function getRPCClient(service = 'dmp', argv = {}, config = null) {
	if (!config) config = projectConfig;

	let serviceConfig = config.services[service];
	if (!serviceConfig) throw new Error('Service not found');

	let server = argv.server || serviceConfig.server;
	let authServer = argv['auth-server'] || config.auth.server;
	let serverOptions = {
		server,
		authServer,
		routeVersion: serviceConfig.routeVersion
	};
	if (argv.verbose) serverOptions.logRequests = true;

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
	return new ZipsceneRPCClient(options);
}

function getAuxRPCClient(auxService, dmpApiClient, argv = {}, config = null) {
	if (!config) config = projectConfig;
	let serviceConfig = config.services[auxService];
	if (!serviceConfig) throw new Error('Service not found');
	let options = objtools.deepCopy(dmpApiClient.settings);
	options.server = argv['file-server'] || serviceConfig.server;
	options.routeVersion = serviceConfig.routeVersion;
	return new ZipsceneRPCClient(options);
}

async function getDataClient(profileType, argv = {}, config = null) {
	if (!config) config = projectConfig;
	let rpcClient = await getRPCClient('dmp', argv, config);
	let fileClient;
	if (config.services.file) {
		fileClient = getAuxRPCClient('file', rpcClient, argv, config);
	}
	return new ZipsceneDataClient(rpcClient, profileType, {
		fileServiceClient: fileClient
	});
}


module.exports = {
	ZipsceneRPCClient,
	ZipsceneDataClient,
	config: projectConfig,
	getRPCClient,
	getAuxRPCClient,
	getDataClient
};

