'use strict';

let chans = require('./channel');
let crypto = require('crypto');
let http = require('http');
let https = require('https');
let jsedn = require('jsedn');
let query = require('./query.js');
let transit = require('transit-js');
let uuid = require('uuid');
let tx = require('./tx.js');

function getState(v) {
    if (v instanceof Db || v instanceof Connection) {
        return v.getState();
    } else {
        return v;
    }
}

function getRequestContext(v) {
    if (v instanceof Db || v instanceof Connection) {
        return v.getRequestContext();
    } else {
        return v;
    }
}

const uuidTag = new jsedn.Tag('uuid');
jsedn.setTagAction(uuidTag, (v) => new jsedn.Tagged(uuidTag, v));

/**
 * A wrapper around a UUID value.
 *
 * @param s The UUID string.
 * @constructor UUID
 */
function UUID(s) {
    if (uuidPat.exec(s) != null) {
        this.rep = s;
    } else {
        throw new Error('invalid UUID string');
    }
}

/**
 * A wrapper around a big integer value.
 *
 * @param {Number|String} i The number value.
 * @constructor BigInt
 */
function BigInt(i) {
    if (typeof i == 'number') {
        this.rep = Math.floor(i).toString();
    } else if (typeof i == 'string' && /[0-9]+/.exec(i) != null) {
        this.rep = i;
    } else {
        throw new Error('invalid integer');
    }
}

BigInt.prototype.toString = function () {
    return this.rep;
};

/**
 * A wrapper around a big decimal value.
 *
 * @param {Number|String} d The number value.
 * @constructor BigDec
 */
function BigDec(d) {
    if (typeof d == 'number') {
        this.rep = d.toString();
    } else if (typeof d == 'string' && /^[0-9]+(\.[0-9]+)?$/.exec(d) != null) {
        this.rep = d;
    } else {
        throw new Error('invalid integer');
    }
}

BigDec.prototype.toString = function () {
    return this.rep;
};

function convertAnomaly(anom) {
    if (transit.isMap(anom)) {
        let ret = {};
        anom.forEach((v, k) => {
            if (transit.isKeyword(k)) {
                k = k._name;
            }
            if (transit.isKeyword(v)) {
                v = v._name;
            }
            ret[k] = v;
        });
        return ret;
    } else {
        return anom;
    }
}

function AnomalyError(anomaly) {
    let anom = convertAnomaly(anomaly);
    this.name = 'AnomalyError';
    this.message = JSON.stringify(anom);
    this.anomaly = anom;
    this.stack = (new Error()).stack;
}

AnomalyError.prototype = new Error;

function isAnomaly(m) {
    if (m == null) {
        return false;
    } else if (transit.isMap(m)) {
        return m.get(transit.keyword('cognitect.anomalies/category')) !== undefined
    } else if (typeof m == 'object') {
        return m['cognitect.anomalies/category'] !== undefined;
    } else {
        return false;
    }
}

function anom(m) {
    if (isAnomaly(m)) {
        return m;
    }
}

function selectKeys(o, keys) {
    if (typeof o == 'object') {
        let result = {};
        for (let k in o) {
            if (keys.indexOf(k) >= 0) {
                result[k] = o[k];
            }
        }
        return result;
    } else {
        return o;
    }
}

/**
 * A database reference. Retrieve this from {@link Connection.db}.
 *
 * @constructor Db
 */
function Db(client, conn, info) {
    this.client = client;
    this.conn = conn;
    this.info = info;
}

const dbContextKeys = ['dbName', 'databaseId', 't', 'nextT', 'asOf', 'since', 'history', 'nextToken'];
const stateKeys = ['t', 'nextT'];

Db.prototype.toQueryArg = function() {
    return selectKeys(this.info, dbContextKeys);
};

Db.prototype.getClient = function () {
    return this.client;
};

Db.prototype.getConn = function() {
    return this.conn;
};

Db.prototype.getState = function() {
    return selectKeys(this.info, stateKeys);
};

Db.prototype.getRequestContext = function () {
    return selectKeys(this.info, dbContextKeys);
};

/**
 * Return a database value as of the given t value.
 * @param t The database t query as of.
 * @returns {Db} The new Db.
 */
Db.prototype.asOf = function(t) {
    let m = Object.assign({}, this.info, {asOf: t});
    return new Db(this.client, this.conn, m);
};

/**
 * Fetch datoms from the index.
 *
 * Arguments in the argument map include:
 *
 * <ul>
 *     <li>index: one of {@link client.EAVT}, {@link client.AVET}, {@link client.AEVT}, or {@link client.VAET}.</li>
 *     <li>components: an array of components to match against the index.</li>
 * </ul>
 *
 * And the following optional arguments:
 *
 * <ul>
 *     <li>timeout -- query timeout in milliseconds. Default 60s.</li>
 *     <li>offset -- the offset in the result set. Default 0.</li>
 *     <li>limit -- the maximum number of results to read. Default 1000.</li>
 *     <li>chunk -- the maximum number of results to return in each chunk. Default 1000.</li>
 * </ul>
 *
 * @param m {object} The arguments.
 * @returns {Promise<channel.Channel>} The channel that will return chunks of
 *  datoms.
 */
Db.prototype.datoms = function (m) {
    return this.client.chunkedAsyncOp(this.conn, keyword('datoms'), this, m);
};

/**
 * Return stats about the database.
 *
 * @returns {Promise<*>} The promise that will yield the stats.
 */
Db.prototype.dbStats = function() {
    return this.client.asyncOp(this.conn, keyword('db-stats'), this, null);
};

/**
 * Return a database value that scans the history of the database.
 *
 * @returns {Db} The new history database value.
 */
Db.prototype.history = function () {
    let m = Object.assign({}, this.info, {history: true});
    return new Db(this.client, this.conn, m);
};

/**
 * Return a promise that yields a channel that returns datoms read out
 * of the AVET index.
 *
 * Arguments supported in the argument map:
 *
 * <ul>
 *     <li>attrid -- the attribute to scan.</li>
 *     <li>start -- an optional start attribute value.</li>
 *     <li>end -- an optional end attribute value.</li>
 *     <li>timeout -- query timeout in milliseconds. Default 60s.</li>
 *     <li>offset -- the offset in the result set. Default 0.</li>
 *     <li>limit -- the maximum number of results to read. Default 1000.</li>
 *     <li>chunk -- the maximum number of results to return in each chunk. Default 1000.</li>
 * </ul>
 *
 * @param m The arguments.
 * @returns {Promise<channel.Channel>} The promise that yields the channel, or an error.
 */
Db.prototype.indexRange = function (m) {
    return this.client.chunkedAsyncOp(this.conn, keyword('index-range'), this, m);
};

/**
 * Pull attributes from the database.
 *
 * Arguments include:
 *
 * <ul>
 *     <li>eid: the entity ID to pull. Either an entity ID (number, bigint, or array for an entity reference).</li>
 *     <li>selector: a selector expression</li>
 *     <li>timeout: an optional timeout in milliseconds.</li>
 * </ul>
 *
 * @param m The arguments.
 * @returns {Promise<Object>} The pulled value.
 */
Db.prototype.pull = function (m) {
    return this.client.asyncOp(this.conn, keyword('pull'), this, m);
};

/**
 * Return a database value that only includes facts asserted after the
 * given t value.
 *
 * @param t The t value.
 * @returns {Db} The new database value.
 */
Db.prototype.since = function(t) {
    let m = Object.assign({}, this.info, {since: t});
    return new Db(this.client, this.conn, m);
};

/**
 * Acts like {@link Connection.transact}, but does not alter the database.
 *
 * Takes similar values as transact. This must only be called on a database
 * value returned by {@link Connection.withDb}, or by another call to with.
 *
 * @param m The arguments.
 * @returns {Promise<Object>} A promise yielding the transaction result.
 */
Db.prototype.with = function (m) {
    return this.client.asyncOp(this.conn, ':with', this, m);
};

/**
 * A connection to a Datomic database.
 *
 * @constructor Connection
 */
function Connection(client, state, info, refreshInterval, lastRefresh) {
    this.client = client;
    this.state = state;
    this.info = info;
    this.refreshInterval = refreshInterval;
    this.lastRefresh = lastRefresh;
}

Connection.prototype.advanceT = function(db) {
    let newState = this.state;
    let thisT = this.state.t;
    if (thisT === undefined) {
        thisT = -1;
    }
    db = transitToJs(db);
    if (db.t > thisT) {
        newState = selectKeys(db, stateKeys);
    }
    this.state = newState;
    return this;
};

Connection.prototype.status = function() {
    return this.client.asyncOp(null, ':status', this, this.info);
};

Connection.prototype.isStale = function () {
    return Date.now() > (this.lastRefresh + this.refreshInterval);
};

Connection.prototype.getClient = function () {
    return this.client;
};

Connection.prototype.getConn = function () {
    return this;
};

Connection.prototype.getRequestContext = function () {
    return Object.assign({}, this.state, this.info);
};

Connection.prototype.getState = function() {
    return this.state;
};

/**
 * Sync with the most recent transaction on the server, and return
 * a Db value with that state.
 *
 * @returns {Promise<Db>} The Db synced with the server.
 */
Connection.prototype.recentDb = function () {
    if (this.isStale()) {
        this.status().then(function(status) {
            if (isAnomaly(status)) {
                return status;
            } else {
                this.advanceT(status);
                this.lastRefresh = Date.now();
                return Connection.this.db();
            }
        });
    } else {
        return Promise.resolve(this.db());
    }
};

/**
 * Return the most recent known database value (does not communicate
 * over the network).
 *
 * @returns {Db} The database.
 */
Connection.prototype.db = function () {
    return new Db(this.client, this, getRequestContext(this));
};

Connection.prototype.log = function () {
    return {log: this.info['database-id']};
};

/**
 * Query the database. Returns a promise that will yield a {@link channel.Channel}
 * that can be read from to fetch results; in case of error, the promise
 * will be rejected with the error.
 *
 * The argument map must contain the following keys:
 *
 * <ul>
 *     <li>query -- the query to run. See {@link query.QueryBuilder} for
 *       help building queries.</li>
 *     <li>args -- arguments to the query (an array).</li>
 * </ul>
 *
 * Also supports the following optional keys:
 *
 * <ul>
 *     <li>timeout -- query timeout in milliseconds. Default 60s.</li>
 *     <li>offset -- the offset in the result set. Default 0.</li>
 *     <li>limit -- the maximum number of results to read. Default 1000.</li>
 *     <li>chunk -- the maximum number of results to return in each chunk. Default 1000.</li>
 * </ul>
 *
 * @param m The argument map.
 * @returns {Promise<channel.Channel>} The promise yielding the channel of results.
 */
Connection.prototype.q = function (m) {
    return this.client.chunkedAsyncOp(this, transit.keyword('q'), this, m);
};

/**
 * Return a database value synced to the current value t.
 *
 * @param t {Number} The database t value.
 * @returns {Promise<Db>} The promise that yields the synced database.
 */
Connection.prototype.sync = function (t) {
    if (typeof t != 'number') {
        throw new Error('t must be a number');
    }
    this.advanceT({t: t});
    return Promise.resolve(this.db());
};

/**
 * Get transactions from the transaction log.
 *
 * The argument supports the following keys:
 *
 * <ul>
 *     <li>start: The optional start date or t value.</li>
 *     <li>end: The optional end date or t value.</li>
 *     <li>timeout: query timeout in milliseconds. Default 60s.</li>
 *     <li>offset: the offset in the result set. Default 0.</li>
 *     <li>limit: the maximum number of results to read. Default 1000.</li>
 *     <li>chunk: the maximum number of results to return in each chunk. Default 1000.</li>
 * </ul>
 *
 * @param m The arguments.
 * @returns {Promise<channel.Channel>} The promise that yields the channel of chunks.
 */
Connection.prototype.txRange = function (m) {
    return this.client.chunkedAsyncOp(this, transit.keyword('tx-range'), this, m);
};

/**
 * Transact facts to the database.
 *
 * The argument is an object that should contain the key:
 *
 * <ul>
 *     <li>txData: an array representing the transaction.</li>
 * </ul>
 *
 * @param m
 * @returns {*}
 */
Connection.prototype.transact = function (m) {
    return this.client.asyncOp(this, transit.keyword('transact'), this, m);
};

/**
 * Return a promise that yields a database value that can be used to run
 * a transaction without changing the database..
 *
 * @returns {Promise<Db>} The promise that yields the db.
 */
Connection.prototype.withDb = function () {
    return this.client.asyncOp(this, transit.keyword('with-db'), this, null);
};

// Client

function Client(spi) {
    this.spi = spi;
}

const transactorTrust = '-----BEGIN CERTIFICATE-----\n' +
    'MIICTzCCAbigAwIBAgIETyWfxDANBgkqhkiG9w0BAQUFADBsMRAwDgYDVQQGEwdV\n' +
    'bmtub3duMRAwDgYDVQQIEwdVbmtub3duMRAwDgYDVQQHEwdVbmtub3duMRAwDgYD\n' +
    'VQQKEwdVbmtub3duMRAwDgYDVQQLEwdVbmtub3duMRAwDgYDVQQDEwdVbmtub3du\n' +
    'MB4XDTEyMDEyOTE5MzYzNloXDTIyMDEyNjE5MzYzNlowbDEQMA4GA1UEBhMHVW5r\n' +
    'bm93bjEQMA4GA1UECBMHVW5rbm93bjEQMA4GA1UEBxMHVW5rbm93bjEQMA4GA1UE\n' +
    'ChMHVW5rbm93bjEQMA4GA1UECxMHVW5rbm93bjEQMA4GA1UEAxMHVW5rbm93bjCB\n' +
    'nzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEA1E7f8OfsClwj9+pN2N0KbmZKt7+I\n' +
    'xlRVNBldjaZfwjJEnea2pY9c9e+UveneuGugG2hOA/pICy3gmZyBTVUeXIOSdBEq\n' +
    'CRvoJtk7FkmueWMY8ioZ0ygtSofTipPzYO9gDW032K3Z+bVmy9xj15K2aapRGeqF\n' +
    'p38jQWVRdOoHJqsCAwEAATANBgkqhkiG9w0BAQUFAAOBgQDTX5KkZSY1gp6/+8/w\n' +
    'vopGEFdwMt+CE8JTVlCh/xMTU5C3qxRqJNstP2IzhgdGKbl24nwafh8jUrC5EzDR\n' +
    'CnQL0zx9KwImGqNGkszSimgfijxDRHDT6Ig15Bg07y4HxJgZNjxnIkNgjM7NgYzk\n' +
    'QPBwyiyvf3HQDczNlFxUwVZVQQ==\n' +
    '-----END CERTIFICATE-----';

function ExpBackoff(start, max, factor) {
    this.value = start / factor;
    this.factor = factor;
    this.max = max;
}

ExpBackoff.prototype.backOff = function(error) {
    let newValue = this.value * this.factor;
    this.value = newValue;
    if (newValue < this.max) {
        return new Promise(resolve => {
            setTimeout(() => { resolve(null); }, newValue);
        });
    } else {
        return Promise.reject(error);
    }
};

function LinearBackoff(timeout, count) {
    this.timeout = timeout;
    this.count = count;
}

LinearBackoff.prototype.backOff = function(error) {
    this.count = this.count - 1;
    if (this.count > 0) {
        let to = this.timeout;
        return new Promise(resolve => {
            setTimeout(() => { resolve(null); }, to);
        });
    } else {
        return Promise.reject(error);
    }
};

function sendWithRetry(httpRequest, requestContext, spi, timeout) {
    let signParams = spi.getSignParams(httpRequest, requestContext);
    if (signParams == null) {
        signParams = spi.refreshSignParams(httpRequest, requestContext);
    } else {
        signParams = Promise.resolve(signParams);
    }
    let uBackoff = new ExpBackoff(100, 400, 2);
    let bBackoff = new LinearBackoff(10000, 6);
    return doSendWithRetry(httpRequest, requestContext, spi, timeout, signParams, uBackoff, bBackoff);
}

const retriableCategories = ['cognitect.anomalies/unavailable', 'cognitect.anomalies/interrupted', 'cognitect.anomalies/fault'];
const idempotentOps = [
    'datomic.catalog/resolve-db',
    'datomic.catalog/list-dbs',
    'datoms',
    'datomic.client.protocol/db-stats',
    'datomic.client.protocol/index-range',
    'datomic.client.protocol/next',
    'datomic.client.protocol/pull',
    'datomic.client.protocol/q',
    'datomic.client.protocol/status',
    'datomic.client.protocol/tx-range',
    'datomic.client.protocol/with',
    'datomic.client.protocol/with-db'
];

function retryAnom(category, op) {
    return retriableCategories.indexOf(category) >= 0 && idempotentOps.indexOf(op) >= 0;
}

function doSendWithRetry(httpRequest, requestContext, spi, timeout, signParams, uBackoff, bBackoff) {
    let execRequest = function(signParams) {
        let signedRequest = signRequest(httpRequest, signParams);
        signedRequest.timeout = timeout;
        signedRequest.ca = transactorTrust;
        signedRequest.checkServerIdentity = function(_, __) {};
        if (spi.getAgent() != null) {
            signedRequest.agent = spi.getAgent();
        }
        return new Promise((resolve, reject) => {
            let cb = (response) => {
                response.bodyData = '';
                response.on('data', (chunk) => {
                    response.bodyData = response.bodyData + chunk;
                });
                response.on('end', () => {
                    resolve(response);
                });
            };
            let req;
            if (signedRequest.scheme === 'http') {
                req = http.request(signedRequest, cb);
            } else {
                req = https.request(signedRequest, cb);
            }
            req.on('timeout', () => {
                reject(new AnomalyError({
                    'cognitect.anomalies/category': 'cognitect.anomalies/interrupted',
                    'cognitect.anomalies/message': 'request timed out'
                }))
            });
            req.on('error', (error) => {
                reject(error);
            });
            if (signedRequest.body != null) {
                req.write(signedRequest.body);
            }
            req.end();
        });
    };
    let handleResponse = function(response) {
        let reader = transit.reader('json');
        let body = null;
        if (response.headers['content-type'] === 'application/transit+json') {
            body = reader.read(response.bodyData);
        }
        if (isAnomaly(body)) {
            throw new AnomalyError(body);
        } else if (response.statusCode >= 500) {
            let cat = 'cognitect.anomalies/fault';
            if (response.statusCode >= 502 && response.statusCode <= 504) {
                cat = 'cognitect.anomalies/unavailable';
            }
            throw new AnomalyError({
                'cognitect.anomalies/category': cat,
                'status': response.statusCode,
                'headers': response.headers,
                'body': response.bodyData
            });
        } else if (response.statusCode >= 400) {
            let cat = 'cognitect.anomalies/incorrect';
            if (response.statusCode === 403) {
                cat = 'cognitect.anomalies/forbidden';
            }
            if (response.statusCode === 429) {
                cat = 'cognitect.anomalies/busy';
            }
            throw new AnomalyError({
                'cognitect.anomalies/category': cat,
                'status': response.statusCode,
                'headers': response.headers,
                'body': response.bodyData
            });
        } else {
            response.body = body;
            return response;
        }
    };
    let catchError = function(error) {
        if (error instanceof AnomalyError) {
            let cat = error.anomaly['cognitect.anomalies/category'];
            if (cat === 'cognitect.anomalies/busy') {
                bBackoff.backOff(error).then(() => {
                    return doSendWithRetry(httpRequest, requestContext, spi, timeout, signParams, uBackoff, bBackoff);
                });
            } else if (cat === 'cognitect.anomalies/forbidden') {
                return signParams.then((oldSignParams) => {
                    return spi.refreshSignParams(httpRequest, requestContext).then((newSignParams) => {
                        let equal = true;
                        for (let k in newSignParams) {
                            if (newSignParams.hasOwnProperty(k) && oldSignParams.hasOwnProperty(k)) {
                                let v1 = newSignParams[k];
                                let v2 = oldSignParams[k];
                                if (v1 !== v2) {
                                    equal = false;
                                    break;
                                }
                            }
                        }
                        if (equal) {
                            throw error;
                        } else {
                            return doSendWithRetry(httpRequest, requestContext, spi, timeout, Promise.resolve(newSignParams), uBackoff, bBackoff);
                        }
                    });
                });
            } else if (retryAnom(cat, httpRequest.op)) {
                uBackoff.backOff(error).then(() => {
                    return doSendWithRetry(httpRequest, requestContext, spi, timeout, signParams, uBackoff, bBackoff);
                });
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    };
    return signParams.then(execRequest).then(handleResponse).catch(catchError);
}

const signedHeaders = ['content-type', 'host', 'x-amz-content-sha256', 'x-amz-date', 'x-amz-target'];

function canonicalHeadersStr(headers) {
    return signedHeaders.map((hdr) => {
        let v = headers[hdr];
        if (v !== undefined) {
            return hdr + ':' + v + '\n';
        } else {
            return '';
        }
    }).join('');
}

function canonicalRequestStr(request) {
    let path = request.path;
    if (path == null || path === '') {
        path = '/';
    }
    return request.method.toUpperCase() + '\n' +
        path + '\n' +
        '\n' +   // no query params
        canonicalHeadersStr(request.headers) + '\n' +
        signedHeaders.join(';') + '\n' +
        request.headers['x-amz-content-sha256'];
}

function canonicalRequestHash(request) {
    let requestStr = canonicalRequestStr(request);
    return crypto.createHash('sha256').update(requestStr).digest().toString('hex');
}

function credentialScope(service, region, xAmzDate) {
    return [xAmzDate.split('T')[0], region, service, 'aws4_request'].join('/');
}

function stringtoSign(xAmzDate, credentialScope, requestHash) {
    return ['AWS4-HMAC-SHA256', xAmzDate, credentialScope, requestHash].join('\n');
}

function escapeAccessKeyId(accessKeyId) {
    return accessKeyId.split('/').join('\\');
}
exports.escapeAccessKeyId = escapeAccessKeyId;

function unescapeAccessKeyId(accessKeyId) {
    return accessKeyId.split('\\').join('/');
}

function formatSignature(accessKeyId, credentialScope, signedHeaders, signature) {
    return 'AWS4-HMAC-SHA256 Credential=' + escapeAccessKeyId(accessKeyId) +
        '/' + credentialScope + ', SignedHeaders=' + signedHeaders +
        ', Signature=' + signature;
}

function hmacSha256(key, input) {
    let mac = crypto.createHmac('sha256', key);
    mac.update(input);
    return mac.digest();
}

function signRequest(request, signParams) {
    if (typeof signParams.accessKey == 'string'
        && typeof signParams.secret == 'string'
        && typeof signParams.service == 'string'
        && typeof signParams.region == 'string') {
        request = Object.assign({}, request);
        let pattern = /\.[0-9]{3}Z/;
        let now = new Date();
        let amzDate = now.toJSON().replace(pattern, 'Z').split(/[-:]/).join('');
        let amzSha = crypto.createHash('sha256').update(request.body).digest().toString('hex');
        request.headers['x-amz-date'] = amzDate;
        request.headers['x-amz-content-sha256'] = amzSha;
        let crh = canonicalRequestHash(request);
        let cs = credentialScope(signParams.service, signParams.region, amzDate);
        let ss = stringtoSign(amzDate, cs, crh);
        let dateToSign = amzDate.split('T')[0];
        let k = hmacSha256("AWS4" + signParams.secret, dateToSign);
        k = hmacSha256(k, signParams.region);
        k = hmacSha256(k, signParams.service);
        let derivedKey = hmacSha256(k, 'aws4_request');
        let signature = hmacSha256(derivedKey, ss).toString('hex');
        request.headers['authorization'] = formatSignature(signParams.accessKey, cs, signedHeaders.join(';'), signature);
        return request;
    } else {
        throw new AnomalyError({'cognitect.anomalies/category': 'cognitect.anomalies/incorrect'});
    }
}

function toTitleCase(s) {
    return s[0].toUpperCase() + s.slice(1);
}

function camelCaseToKebabCase(s) {
    return s.split(/(?=[A-Z])/).map(x => x.toLowerCase()).join('-');
}

function keywordizeKey(k) {
    if (typeof k == 'string') {
        if (k.indexOf('/') >= 0) {
            return keyword(k);
        } else {
            return keyword(camelCaseToKebabCase(k));
        }
    } else {
        return k;
    }
}

const uuidPat = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
function jsToTransit(m) {
    if (Array.isArray(m)) {
        return m.map(jsToTransit);
    } else if (m instanceof UUID) {
        return transit.uuid(m.rep);
    } else if (m instanceof BigInt) {
        return transit.bigInt(m.rep);
    } else if (m instanceof BigDec) {
        return transit.bigDec(m.rep);
    } else if (m instanceof Db) {
        return jsToTransit(m.toQueryArg());
    } else if (m instanceof jsedn.Map) {
        let ret = transit.map();
        m.each((v, k) => {
            ret.set(jsToTransit(k), jsToTransit(v));
        });
        return ret;
    } else if (m instanceof jsedn.List) {
        return transit.list(m.val.map(jsToTransit));
    } else if (m instanceof jsedn.Set) {
        return transit.set(m.val.map(jsToTransit));
    } else if (m instanceof jsedn.Vector) {
        return m.val.map(jsToTransit);
    } else if (m instanceof jsedn.Tagged) {
        if (m.tag() === uuidTag) {
            return transit.uuid(m.obj());
        } else {
            throw new Error(`can't convert tagged value '${m.dn()}' to transit`)
        }
    } else if (m instanceof jsedn.Keyword) {
        return transit.keyword(m.val.slice(1));
    } else if (m instanceof jsedn.Symbol) {
        return transit.symbol(m.val);
    } else if (m instanceof jsedn.BigInt) {
        return transit.bigInt(m.val);
    } else if (transit.isTaggedValue(m) || transit.isKeyword(m) || transit.isSymbol(m)) {
        return m;
    } else if (typeof m == 'object') {
        let ret = transit.map([]);
        for (let k in m) {
            if (m.hasOwnProperty(k)) {
                ret.set(keywordizeKey(k), jsToTransit(m[k]));
            }
        }
        return ret;
    } else {
        return m;
    }
}

function transitToJs(m) {
    if (transit.isList(m)) {
        return m.rep.map(transitToJs);
    } else if (transit.isMap(m)) {
        let ret = {};
        m.forEach((v, k) => {
            k = transitToJs(k);
            v = transitToJs(v);
            ret[k] = v;
        });
        return ret;
    } else if (transit.isSet(m)) {
        let ret = [];
        m.forEach((v) => {
            ret.push(transitToJs(v));
        });
        return ret;
    } else if (Array.isArray(m)) {
        return m.map(transitToJs);
    } else if (transit.isKeyword(m) || transit.isSymbol(m)) {
        if (m.namespace() != null) {
            return m.namespace() + '/' + m.name();
        } else {
            let parts = m.name().split('-');
            return parts[0] + parts.slice(1).map(toTitleCase).join('');
        }
    } else if (transit.isUUID(m)) {
        return new UUID(m.toString());
    } else if (transit.isBigInt(m)) {
        return new BigInt(m.rep);
    } else if (transit.isBigDec(m)) {
        return new BigDec(m.rep);
    } else if (transit.isTaggedValue(m) && m.tag === 'datom') {
        return {
            e: transitToJs(m.rep[0]),
            a: transitToJs(m.rep[1]),
            v: transitToJs(m.rep[2]),
            tx: transitToJs(m.rep[3]),
            added: transitToJs(m.rep[4])
        };
    } else if (transit.isInteger(m) && typeof m !== 'number') {
        return new BigInt(m.toString());
    } else {
        return m;
    }
}

function clientResponseToApi(conn, op, requester, response) {
    switch (op.toString()) {
        case ':transact':
        case ':with':
            return {
                dbBefore: new Db(this, conn,
                                 Object.assign({}, selectKeys(getRequestContext(requester), ['databaseId', 'dbName']),
                                               selectKeys(transitToJs(response.get(keyword('db-before'))), dbContextKeys))),
                dbAfter: new Db(this, conn,
                                Object.assign({}, selectKeys(getRequestContext(requester), ['databaseId', 'dbName']),
                                              selectKeys(transitToJs(response.get(keyword('db-after'))), dbContextKeys))),
                txData: transitToJs(response.get(keyword('tx-data'))),
                tempids: transitToJs(response.get(keyword('tempids')))
            };
        case ':datoms':
        case ':q':
        case ':tx-range':
        case ':index-range':
        case ':next':
            return transitToJs(response.get(keyword('data')));
        case ':pull':
        case ':db-stats':
        case ':datomic.catalog/list-dbs':
            return transitToJs(response.get(keyword('result')));
        case ':with-db':
            return new Db(this, conn,
                Object.assign({}, getRequestContext(requester), selectKeys(transitToJs(response), dbContextKeys)));
        case ':datomic.catalog/create-db':
        case ':datomic.catalog/delete-db':
            return true;
        default:
            return transitToJs(response);
    }
}

function updateState(conn, response) {
    if (response != null) {
        let dbs = response.get(keyword('dbs'));
        let dbAfter = response.get(keyword('db-after'));
        if (conn != null && conn.info != null) {
            if (dbs != null) {
                dbs.forEach((db) => {
                    if (db.get(keyword('database-id')) === conn.info.databaseId) {
                        conn.advanceT(db);
                    }
                });
            } else if (dbAfter != null) {
                if (dbAfter.get(keyword('database-id')) === conn.info.databaseId) {
                    conn.advanceT(dbAfter);
                }
            }
        }
    }
}

function convertResponse(conn, op, requester, response, handler) {
    updateState(conn, response);
    return handler(conn, op, requester, response);
}

Client.prototype.asyncOp = function (conn, op, requester, m) {
    let requestContext = getRequestContext(requester);
    let request = apiToClientRequest(op, requestContext, m);
    let httpRequest = clientRequestToHttpRequest(request);
    let routedHttpRequest = this.spi.addRouting(httpRequest);
    m = m || {};
    return sendWithRetry(routedHttpRequest, requestContext, this.spi, m.timeout || 60000).then(
        (result) => {
            let res = null;
            if (result != null) {
                res = result.body;
            }
            return convertResponse(conn, op, requester, res, clientResponseToApi);
        }
    );
};

function convertChunkedResponse(conn, op, requester, response, handler, spi, requestContext, timeout, channel) {
    updateState(conn, response);
    let resp = handler(conn, op, requester, response);
    channel.put(resp).then((result) => {
        if (result) {
            let nextOffset = response.get(keyword('next-offset'));
            if (nextOffset != null) {
                let nextOp = keyword('next');
                let nextRequest = Object.assign({}, requestContext,
                    {
                        op: nextOp,
                        nextToken: response.get(keyword('next-token')),
                        offset: nextOffset,
                        chunk: response.get(keyword('chunk'))
                    });
                let nextClientRequest = apiToClientRequest(nextOp, requester, nextRequest);
                let nextHttpRequest = clientRequestToHttpRequest(nextClientRequest);
                let nextRoutedRequest = spi.addRouting(nextHttpRequest);
                return sendWithRetry(nextRoutedRequest, requestContext, spi, timeout || 60000).then(
                    (result) => {
                        convertChunkedResponse(conn, nextOp, requester, result.body, handler, spi, requestContext, timeout, channel);
                    }
                );
            } else {
                channel.close();
            }
        }
    });
}

Client.prototype.chunkedAsyncOp = function (conn, op, requester, m) {
    let channel = new chans.Channel();
    let requestContext = getRequestContext(requester);
    let request = apiToClientRequest(op, requestContext, m);
    let httpRequest = clientRequestToHttpRequest(request);
    let routedHttpRequest = this.spi.addRouting(httpRequest);
    m = m || {};
    return sendWithRetry(routedHttpRequest, requestContext, this.spi, m.timeout || 60000).then(
        (result) => {
            convertChunkedResponse(conn, op, requester, result.body, clientResponseToApi, this.spi, requestContext, m.timeout, channel);
            return channel;
        }
    );
};

Client.prototype.connect = function(m) {
    if (typeof m.dbName != 'string') {
        throw new Error('expected string for key dbName');
    } else {
        let address = {dbName: m.dbName};
        let _this = this;
        return this.asyncOp(null, keyword('datomic.catalog/resolve-db'), address, m).then(
            (resolved) => {
                return _this.asyncOp(null, keyword('status'), address, Object.assign({}, m, resolved)).then(
                    (status) => {
                        return new Connection(_this, selectKeys(status, stateKeys), {dbName: m.dbName, databaseId: status.databaseId});
                    }
                );
            }
        );
    }
};

Client.prototype.listDatabases = function(m) {
    return this.asyncOp(null, keyword('datomic.catalog/list-dbs'), m, null);
};

Client.prototype.createDatabase = function(m) {
    return this.asyncOp(null, keyword('datomic.catalog/create-db'), m, {dbName: m.dbName});
};

Client.prototype.deleteDatabase = function(m) {
    return this.asyncOp(null, keyword('datomic.catalog/delete-db'), m, {dbName: m.dbName});
};

function convertSelector(s) {
    if (Array.isArray(s)) {
        return transit.list(s.map(convertSelector));
    } else if (typeof s == 'object') {
        let a = [];
        for (let k in s) {
            if (s.hasOwnProperty(k)) {
                a.push(convertSelector(k));
                a.push(convertSelector(s[k]));
            }
        }
        return transit.map(a);
    } else if (typeof s == 'string' && s[0] === ':') {
        return transit.keyword(s.slice(1));
    } else {
        return s;
    }
}

function keyword(v) {
    if (transit.isKeyword(v)) {
        return v;
    } else if (typeof v == 'string') {
        if (v[0] === ':') {
            return transit.keyword(v.slice(1));
        } else {
            return transit.keyword(v);
        }
    } else {
        throw Error('failed to convert value to keyword');
    }
}

function keywordizeKeys(m) {
    if (Array.isArray(m)) {
        return transit.list(m.map(keywordizeKeys));
    } else if (typeof m == 'object') {
        let a = [];
        for (let k in m) {
            if (m.hasOwnProperty(k)) {
                a.push(keyword(k));
                a.push(keywordizeKeys(m[k]));
            }
        }
        return transit.map(a);
    } else {
        return m;
    }
}

function apiToClientRequest(op, requester, m) {
    if (op.toString() === ':datomic.catalog/create-db' || op.toString() === ':datomic.catalog/delete-db' || op.toString() === ':connect') {
        if (typeof m.dbName != 'string') {
            throw Error('invalid request');
        }
    } else if (op.toString() === ':transact' || op.toString() === ':with') {
        if (!Array.isArray(m.txData) && !(m.txData instanceof jsedn.Vector)) {
            throw Error('invalid request');
        }
    } else if (op.toString() === ':pull') {
        if (m.eid == null || m.selector == null) {
            throw Error('invalid request');
        }
    } else if (op.toString() === ':datoms') {
        if ([':eavt', ':aevt', ':avet', ':vaet', 'eavt', 'aevt', 'avet', 'vaet'].indexOf(m.index.toString()) === -1) {
            throw Error('invalid request');
        }
    }
    let request = transit.map();
    switch (op.toString()) {
        case ':status':
            request = transit.map([transit.keyword('database-id'), m.databaseId]);
            break;
        case ':datomic.catalog/list-dbs':
        case ':with-db':
        case ':db-stats':
            break;
        case ':datomic.catalog/resolve-db':
        case ':datomic.catalog/create-db':
        case ':datomic.catalog/delete-db':
            request = transit.map([transit.keyword('db-name'), m.dbName]);
            break;
        case ':transact':
        case ':with':
            request = transit.map([transit.keyword('tx-id'), transit.uuid(uuid.v4()),
                                   transit.keyword('tx-data'), jsToTransit(m.txData)]);
            break;
        case ':q':
            request = transit.map([
                transit.keyword('offset'), m.offset || 0,
                transit.keyword('query'), jsToTransit(m.query),
                transit.keyword('args'), jsToTransit(m.args),
                transit.keyword('timeout'), m.timeout || 60000,
                transit.keyword('limit'), m.limit || 1000,
                transit.keyword('chunk'), m.chunk || 1000
            ]);
            break;
        case ':tx-range':
            request = transit.map([
                transit.keyword('offset'), m.offset || 0,
                transit.keyword('start'), m.start || null,
                transit.keyword('end'), m.end || null
            ]);
            break;
        case ':datoms':
            let index = keyword(m.index);
            let comps = m.components;
            if (comps !== undefined) {
                let comps2 = new Array(comps.length);
                switch (index.toString()) {
                    case ':eavt':
                        switch (comps.length) {
                            case 4:
                                comps2[3] = tx.bigInt(comps[3]);
                            case 3:
                                comps2[2] = tx.convertV(comps[2]);
                            case 2:
                                comps2[1] = keyword(comps[1]);
                            case 1:
                                comps2[0] = tx.convertE(comps[0]);
                            default:
                                break;
                        }
                        break;
                    case ':aevt':
                        switch (comps.length) {
                            case 4:
                                comps2[3] = tx.bigInt(comps[3]);
                            case 3:
                                comps2[2] = tx.convertV(comps[2]);
                            case 2:
                                comps2[1] = tx.convertE(comps[1]);
                            case 1:
                                comps2[0] = keyword(comps[0]);
                            default:
                        }
                        break;
                    case ':avet':
                        switch (comps.length) {
                            case 4:
                                comps2[3] = tx.bigInt(comps[3]);
                            case 3:
                                comps2[2] = tx.convertE(comps[2]);
                            case 2:
                                comps2[1] = tx.convertV(comps[1]);
                            case 1:
                                comps2[0] = keyword(comps[0]);
                            default:
                        }
                        break;
                    case ':vaet':
                        switch (comps.length) {
                            case 4:
                                comps2[3] = tx.bigInt(comps[3]);
                            case 3:
                                comps2[2] = tx.convertE(comps[2]);
                            case 2:
                                comps2[1] = keyword(comps[1]);
                            case 1:
                                comps2[0] = tx.convertE(comps[0]);
                            default:
                        }
                        break;
                }
            }
            request = transit.map([
                keyword('index'), keyword(m.index),
                keyword('components'), comps,
                keyword('timeout'), m.timeout || 60000,
                keyword('chunk'), m.chunk || 1000,
                keyword('limit'), m.limit || 1000,
                keyword('offset'), m.offset || 0,
            ]);
            break;
        case ':index-range':
            request = transit.map([
                transit.keyword('offset'), m.index || 0,
                transit.keyword('attrid'), keyword(m.attrid),
                transit.keyword('start'), m.start || null,
                transit.keyword('end'), m.end || null
            ]);
            break;
        case ':pull':
            request = transit.map([
                keyword('eid'), tx.convertE(m.eid),
                keyword('selector'), jsToTransit(m.selector),
                keyword('timeout', m.timeout || 60000)
            ]);
            break;
        case ':next':
            request = jsToTransit(m);
            break;
    }
    request.set(keyword('op'), keyword(op));
    let requestContext = getRequestContext(requester);
    for (let k in requestContext) {
        if (requestContext.hasOwnProperty(k)) {
            request.set(keywordizeKey(k), requestContext[k]);
        }
    }
    return request;
}

function clientRequestToHttpRequest(request) {
    let writer = transit.writer('json');
    let encoded = writer.write(request);
    let contentType = 'application/transit+json';
    let op = request.get(keyword('op'));
    let qualifiedOp = 'datomic.client.protocol/' + op.name();
    if (op.namespace() === 'datomic.catalog') {
        qualifiedOp = op.namespace() + '/' + op.name();
    }
    let headers = {
        'content-type': contentType,
        'accept': contentType,
        'x-nano-op': qualifiedOp,
        'content-length': Buffer.byteLength(encoded)
    };
    let nextToken = request.get(keyword('next-token'));
    if (nextToken !== undefined) {
        headers['x-nano-next'] = nextToken.toString();
    }
    let databaseId = request.get(keyword('database-id'));
    if (databaseId !== undefined) {
        headers['x-nano-target'] = databaseId;
    }
    return {
        headers: headers,
        method: 'post',
        body: encoded,
        op: qualifiedOp
    };
}

function makeClient(spi) {
    return new Client(spi);
}

function makeConnection(spi, args) {
    return makeClient(spi).connect(args);
}

function makeUuid(s) {
    return new UUID(s);
}

function randomUuid() {
    return new UUID(uuid.v4());
}

exports.makeClient = makeClient;
exports.makeConnection = makeConnection;
exports.makeUuid = makeUuid;
exports.randomUuid = randomUuid;

exports.canonicalRequestStr = canonicalRequestStr;

exports.UUID = UUID;
exports.BigInt = BigInt;
exports.BigDec = BigDec;