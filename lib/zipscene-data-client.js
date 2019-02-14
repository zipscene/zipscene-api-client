const objtools = require('objtools');

/**
 * Client for accessing Zipscene DMP profile group data.
 *
 * @class ZipsceneDataClient
 * @constructor
 * @param {ZipsceneRPCClient} rpcClient - The RPC client to use
 * @param {String} profileType - Profile type as it appears in method names (ie, "person")
 */
class ZipsceneDataClient {

	constructor(rpcClient, profileType) {
		this.client = rpcClient;
		this.methodBase = profileType.toLowerCase();
	}

	/**
	 * Gets a single object by id.
	 *
	 * @method get
	 * @param {String} id
	 * @param {Object} [options]
	 *   @param {String[]} options.fields
	 *   @param {Number} options.timeout
	 * @return {Object} - The request object
	 */
	async get(id, options = {}) {
		let result = await this.client.request(this.methodBase + '.get', objtools.merge({}, options, {
			keys: { id }
		}));
		return result.result;
	}

	/**
	 * Executes a query.
	 *
	 * @method query
	 * @param {Object} query
	 * @param {Object} [options]
	 *   @param {String[]} options.fields
	 *   @param {String[]} options.sort
	 *   @param {Number} options.skip
	 *   @param {Number} options.limit
	 *   @param {Number} options.timeout
	 * @return {Object[]} - Array of results
	 */
	async query(query, options = {}) {
		let result = await this.client.request(this.methodBase + '.query', objtools.merge({}, options, {
			query: query
		}));
		return result.results;
	}

	export() {
	}

	/**
	 * Executes a count.
	 *
	 * @method count
	 * @param {Object} query
	 * @param {Object} [options}
	 *   @param {Number} options.timeout
	 * @return {Number}
	 */
	async count(query, options = {}) {
		let result = await this.client.request(this.methodBase + '.count', objtools.merge({}, options, {
			query: query
		}));
		return result.result;
	}

	/**
	 * Executes one or more aggregates.
	 *
	 * @method aggregate
	 * @param {Object} query
	 * @param {Object|Object[]} agg - Aggregate spec, or array of aggregate specs
	 * @param {Object} [options]
	 *   @param {String[]} options.sort
	 *   @param {Number} options.limit
	 *   @param {Number} options.scanLimit
	 *   @param {Number} options.timeout
	 * @return {Mixed} - Aggregate results, or array of aggregate results if 'agg' is an array
	 */
	async aggregate(query, agg, options = {}) {
		let aggMap = {};
		if (Array.isArray(agg)) {
			for (let i = 0; i < agg.length; ++i) {
				aggMap['a' + i] = agg[i];
			}
		} else {
			aggMap.a0 = agg;
		}
		let result = await this.client.request(this.methodBase + '.aggregate', objtools.merge({}, options, {
			query: query,
			aggregates: aggMap
		}));
		let resultMap = result.results;
		if (Array.isArray(agg)) {
			let retArray = [];
			for (let key in resultMap) {
				retArray[parseInt(key.slice(1))] = resultMap[key];
			}
			return retArray;
		} else {
			return resultMap.a0;
		}
	}

}

module.exports = ZipsceneDataClient;

