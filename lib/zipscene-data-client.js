const objtools = require('objtools');
const zstreams = require('zstreams');
const pasync = require('pasync');
const XError = require('xerror');

const FILE_SERVICE_POLL_INTERVAL = 5000;

/**
 * Client for accessing Zipscene DMP profile group data.
 *
 * @class ZipsceneDataClient
 * @constructor
 * @param {ZipsceneRPCClient} rpcClient - The DMP RPC client to use
 * @param {String} profileType - Profile type as it appears in method names (ie, "person")
 * @param {Object} [options]
 *   @param {ZipsceneRPCClient} fileServiceClient - RPC client for the file service
 */
class ZipsceneDataClient {

	constructor(rpcClient, profileType, options = {}) {
		this.client = rpcClient;
		this.methodBase = profileType.toLowerCase();
		this.fileServiceClient = options.fileServiceClient;
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


	/**
	 * Exports a DMP data stream.
	 *
	 * @method export
	 * @param {Object} query
	 * @param {Object} [options]
	 *   @param {String[]} options.fields
	 *   @param {String[]} options.sort
	 *   @param {Number} options.limit
	 *   @param {Number} options.timeout
	 *   @param {String} options.strategy - Export strategy, either 'file' to download via file service or 'stream' to stream directly from DMP
	 * @return {Readable} - A readable object stream
	 */
	export(query, options = {}) {
		const getStream = async() => {
			let strategy;
			if (options.strategy === 'stream') {
				strategy = 'stream';
			} else {
				// Check if DMP supports file service
				let dmpOptions = await this.client.request('get-dmp-options', {});
				if (dmpOptions.fileService && this.fileServiceClient) {
					strategy = 'file';
				} else {
					if (options.strategy === 'file') {
						if (!this.fileServiceClient) {
							throw new XError(XError.UNSUPPORTED_OPERATION, 'File service not configured');
						} else {
							throw new XError(XError.UNSUPPORTED_OPERATION, 'File service not enabled in DMP');
						}
					}
					strategy = 'stream';
				}
			}

			if (strategy === 'stream') {
				return this.client.requestStream(this.methodBase + '.export', {
					query: query,
					fields: options.fields,
					sort: options.sort,
					limit: options.limit,
					timeout: options.timeout
				});
			} else {
				// Start the export to file
				let result = await this.client.request(this.methodBase + '.file-export', {
					query: query,
					fields: options.fields,
					sort: options.sort,
					limit: options.limit,
					timeout: options.timeout
				});
				let fileId = result.fileId;
				
				// Poll file service until file is complete
				for (;;) {
					await pasync.setTimeout(FILE_SERVICE_POLL_INTERVAL);
					let fileState = await this.fileServiceClient.request('get-file-status', { fileId });
					switch (fileState.status) {
						case 'PENDING':
						case 'FINISHED':
							break;
						case 'CANCELLED':
							throw new XError(XError.INTERNAL_ERROR, 'File export cancelled');
						case 'ERROR':
							if (fileState.error && fileState.error.code && fileState.error.message) {
								throw new XError.fromObject(fileState.error);
							} else {
								throw new XError(XError.INTERNAL_ERROR, 'Error exporting file');
							}
						default:
							throw new XError(XError.INTERNAL_ERROR, 'Unexpected file service state: ' + fileState.status);
					}
					if (fileState.status === 'FINISHED') break;
				}

				// Stream downloaded file from file service
				let retStream = this.fileServiceClient.requestRaw('download-file', { fileId })
					.pipe(new zstreams.SplitStream())
					.through((line) => {
						try {
							return JSON.parse(line);
						} catch (err) {
							throw new XError(XError.INVALID_ARGUMENT, 'Error parsing export line', { error: err, line });
						}
					});

				// Clean up file on file service after download is finished
				retStream.on('finish', () => {
					this.fileServiceClient.request('delete-file', { fileId })
						.catch((err) => {
							console.error('Error deleting downloaded file from file service', err);
						});
				});

				return retStream;
			}
		};

		let passthrough = new zstreams.PassThrough({ objectMode: true });
		getStream()
			.then((stream) => {
				stream.pipe(passthrough);
			}, (err) => {
				passthrough.triggerChainError(err);
				//passthrough.emit('error', err);
			})
			.catch(pasync.abort);
		return passthrough;
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

