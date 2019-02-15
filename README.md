# Zipscene API Node.JS Client Library and Command Line Utility

This library is used to authenticate and send requests to the Zipscene API.

## ZS API Command Line

This package includes a command line utility for calling RPC API functions and querying data.

### Installation

To install, `npm install -g zipscene-api-client` and ensure that the `zsapi` executable file is in your PATH.

### Configuration

Configuration for the CLI is not required for normal use, but can be used to store authentication
credentials (so they don't have to be entered every time) and configure different endpoints.

The configuration file defaults can be found in the file `zipscene-api-client-defaults.conf`.  `littleconf` is
used to load configuration, so the override config file can be specified in a few different ways:

- (recommended) A file in your home directory (ex, `.zipscene-api-client.conf`), pointed to by the environment
  variable `ZIPSCENE_API_CLIENT_CONFIG`.  To set this persistently: `echo 'export ZIPSCENE_API_CLIENT_CONFIG=/path/to/.zipscene-api-client.conf' >> ~/.bashrc`
- A file called `zipscene-api-client.conf` located in the zipscene-api-client project directory.
- Specified on the command line with the `--config` option.

An example config file might look like this: (all settings are optional)

```js
{
	// Authentication information
	"auth": {
		// Specify username/password or auth token, both are not needed
		// If a username is specified with no password, the password is prompted for
		"username": "api username",
		"password": "xxxx",
		"accessToken": "xxxx"
	},
	// Server configurations for API services
	"services": {
		"dmp": {
			"server": "https://api.v3.zipscene.com",
			"routeVersion": 2
		},
		"auth": { ... },
		"file": { ... }
	},
	// Configuration environments
	// These settings override the normal config settings when the environment
	// is enabled by setting the NODE_ENV environment variable.
	"environments": {
		"local": {
			"dmp": {
				"server": "http://localhost:3000"
			}
		}
	}
}
```

### Usage/Help

The `zsapi` command provides several subcommands.  To get a list of available subcommands and usage information,
type `zsapi --help`.  To get usage for a specific subcommand (for example, 'rpc'), type: `zsapi rpc --help`.

Options that are common to most/all subcommands:

- `--config <filename>` - Path to configuration file
- `--config-env <environment>` - Configuration environment to use
- `--auth-server <url>` - Authentication server to auth to
- `--username <username>` - API username
- `--password <password>` - Auth password.  Not recommended on the command line.  If not specified, a password will be prompted for.
- `--access-token <token>` - Access token to use instead of username/password
- `--verbose` - Print out verbose info, mostly raw requests/responses
- `--pretty` - Pretty-print JSON output.  Defaults to true.  To disable, `--no-pretty`.
- `--server <url>` - Override primary server to connect to for the operation

### RPC Calls

RPC call to the default service (DMP): `zsapi rpc -m person.query -p '{ "query": {}, "limit": 5 }'`

Specify a service to call: `zsapi rpc -s auth -m login -p '{ "email": "foo@bar.com", "password": "xxxx" }'

Load params from file: `zsapi rpc -m person.query --pfile /path/to/json/file`

### Auth Check

Authenticate and print out access token & auth header: `zsapi auth`

### API Info

List service methods: `zsapi info -l`

Show method info: `zsapi info -m event.query`

List data models: `zsapi info --listmodels`

Show data model: `zsapi info --model OrderGroup`

Show full API info: `zsapi info -a`

### Queries

Run query: `zsapi query -p order -q '{ "brandId": "example" }'`

Run query with limit, sort, fields, and timeout: `zsapi query -p order -q '{}' -l 10 -s id -f id brandId items -t 60`

Load query from file: `zsapi query -p order --qfile /path/to/file`

Fetch single object: `zsapi get -p order -i 'objectid'`

Count: `zsapi count -p order -q '{}'`

Run aggregate: `zsapi agg -p order -q '{}' -a '{ aggregate spec }'`

Run streaming export from DMP: `zsapi export -p order -q '{}' --strategy stream`

Run export through file service: `zsapi export -p order -q '{}' --strategy file`

Note that the default export strategy is determined by querying DMP to detect if the file service is enabled, and using it if so.


## Node.JS Client

The Node.JS client is made up of 2 main classes, along with a few utility functions.

### ZipsceneRPCClient

This is the main API client class for accessing Zipscene APIs.  It provides facilities for authentication
and making RPC API calls.

```js
const { ZipsceneRPCClient } = require('zipscene-api-client');
const settings = {
	server: 'https://api.v3.zipscene.com', // URL of the service to connect to
	authServer: 'https://auth.v3.zipscene.com', // URL of authentication service
	routeVersion: [JSON_RPC_APP_ROUTE_VERSION], // Route version to use for the service

	// Authentication can either provide a username/password
	username: 'example',
	password: 'hunter2',
	// Or an access token
	accessToken: 'xxxx',

	// Optionally log requests and responses to stderr for debugging
	logRequests: true
};
let client = new ZipsceneRPCClient(settings);

// Returns a Promise, resolves with the response data, or rejects with an XError
client.request('jsonrpc.method', {
	param: 'value'
});

// For methods that return data streams of newline-separated JSON objects instead of a
// json rpc response, requestStream returns a zstreams object stream.
client.requestStream('foo.export', {
	param: 'value'
});
```

### ZipsceneDataClient

This client provides a high-level interface for data retrieval.  Each class instance
is specific to a profile type and provides methods to query that profile type.

```js
const { ZipsceneRPCClient, ZipsceneDataClient } = require('zipscene-api-client');

// Construct the DMP API RPC client
const dmpClientSettings = { ... };
let rpcClient = new ZipsceneRPCClient(dmpClientSettings);

// Construct the file service API RPC client
// This is optional, and only needed if using the 'file' export strategy
const fileServiceClientSettings = { ... };
let fileServiceClient = new ZipsceneRPCClient(fileServiceClientSettings);

// Construct the data client
let dataClient = new ZipsceneDataClient(rpcClient, 'profileType', {
	fileServiceClient: fileServiceClient
});

// Query
let resultArray = await dataClient.query({
	query object
}, {
	// Optional list of fields to retrieve
	fields: [ ... ],
	// Optional fields to sort by (prepend with '-' to reverse)
	sort: [ ... ],
	// Limit number of results
	limit: 100,
	// Query timeout (seconds)
	timeout: 60
});

// Get single object
let obj = await dataClient.get('id', { fields: ..., timeout: ... });

// Count query results
let count = await dataClient.count({ query }, { timeout: ... });

// Aggregate
let aggregateResults = await dataClient.aggregate({ query }, { aggregate spec }, {
	sort: [ ... ],
	limit: ...,
	// Maximum number of query results to scan
	scanLimit: 10000000,
	timeout: ...
});

// Export bulk data, returns a Readable object stream
let stream = await dataClient.export({ query }, {
	fields: [ ... ],
	sort: [ ... ],
	limit: [ ... ],
	timeout: [ ... ],
	// This defines the export strategy.  Two are current supported.  'stream' will
	// stream data directly from DMP as it is queried, and 'file' will instead save
	// a file to the file service, then download it and stream it.
	// The 'stream' strategy can sometimes be glitchy on certain connections due to
	// potential long gaps in times between received objects.  The 'file' strategy
	// won't return any results until the export is complete, and must have the
	// file service configured.  The default is to query DMP to check if DMP is configured
	// to use a file service, and use the 'file' strategy if so (and if the file service
	// client is configured).
	strategy: 'file'
});
```


### Usage

```js
const { JsonRPCApiClient } = require('zipscene-api-client');

const settings = {
	server: [JSON_RPC_APP_URL],
	authServer: [AUTH_SERVER_URL],
	routeVersion: [JSON_RPC_APP_ROUTE_VERSION],
	username: [USERNAME],
	password: [PASSWORD]
};

let client = new JsonRPCApiClient(settings);

client.request('some-method', { param: 'value' })
	.then((response) => {
		// handle response
	});

// For methods with streaming responses. Returns a zstream.
client.requestStream('some-streaming-method', { param: 'value' })
	.through( /* Handle chunk of data */);

```

Authentication can be initiated manually via `#authenticate()`, but this is not necessary.

##### Settings
- `server`: (required) the url of the JSON-RPC app
- `authServer`: (optional) the server to authenticate w/ if not the primary JSON-RPC app
- `routeVersion`: (optional) the route version of the JSON-RPC app to access methods on, defaults to `2`
- `legacyAuth`: This will cause the client to make authentication requests against a legacy zsapi server.
- `email`
- `username`
- `password`
- `userNamespaceId`
- `accessToken`
- `refreshToken`

At minimum, (`username` and `password`), `accessToken`, or `refreshToken` must be set

### Development
Just `$ git clone` and `$ npm install`

To run the tests, you will need elasticsearch and redis running on the default ports w/ the elasticsearch index `test_index`

TODO: start these with the rest of the test services
