# zipscene-api-client

This library is used to authenticate and send requests to [zs-dmp-api](https://git.zipscene.com/dmp/zs-dmp-api)

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
