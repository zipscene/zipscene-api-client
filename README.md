# zs-jsonrpc-api-client

This library is used to authenticate and send requests to [zs-dmp-api](https://git.zipscene.com/dmp/zs-dmp-api)

### Usage

```js
const { JsonRPCApiClient } = require('zs-jsonrpc-api-client');

const settings = {
	server: [JSON_RPC_APP_URL],
	username: [USERNAME],
	password: [PASSWORD]
};

const options = {
	authServer: [AUTH_SERVER_URL],
	routeVersion: [JSON_RPC_APP_ROUTE_VERSION]
}

let client = new JsonRPCApiClient(settings, options);

client.request('some-method', { param: 'value' })
	.then((response) => {
		// handle response
	});
```

Authentication can be initiated manually via `#authenticate()`, but this is not necessary

##### Settings
- `server`: required; the url of the JSON-RPC app
- `username`
- `password`
- `accessToken`
- `refreshToken`

At minimum, (`username` and `password`), `accessToken`, or `refreshToken` must be set

##### Options
- `authServer`: the server to authenticate w/ if not the primary JSON-RPC app
- `routeVersion`: the route version of the JSON-RPC app to access methods on

### Development
Just `$ git clone` and `$ npm install`

To run the tests, you will need elasticsearch and redis running on the default ports w/ the elasticsearch index `test_index`

TODO: start these with the rest of the test services
