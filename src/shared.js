'use strict';

let chans = require('./channel')
let crypto = require('crypto');
let http = require('http');
let https = require('https');
let tls = require('tls');
let transit = require('transit-js');
let uuid = require('uuid');

Object.prototype.getState = function() { return this; };
Object.prototype.getRequestContext = function() { return this; };

function UUID(s) {
    if (uuidPat.exec(s) != null) {
        this.rep = s;
    } else {
        throw new Error('invalid UUID string');
    }
}

function BigInt(i) {
    if (typeof i == 'number') {
        this.rep = Math.floor(i).toString();
    } else if (typeof i == 'string' && /[0-9]+/.exec(i) != null) {
        this.rep = i;
    } else {
        throw new Error('invalid integer');
    }
}

function BigDec(d) {
    if (typeof d == 'number') {
        this.rep = d.toString();
    } else if (typeof d == 'string' && /^[0-9]+(\.[0-9]+)?$/.exec(d) != null) {
        this.rep = d;
    } else {
        throw new Error('invalid integer');
    }
}

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

Db.prototype.asOf = function(t) {
    let m = Object.assign({}, this.info, {'as-of': t})
    return new Db(this.client, this.conn, m);
};

Db.prototype.datoms = function (m) {
    return this.client.chunkedAsyncOp(this.client, this.conn, keyword(':datoms'), this, m);
};

Db.prototype.dbStats = function() {
    return this.client.asyncOp(this.conn, keyword(':db-stats'), this, null);
};

Db.prototype.history = function () {
    let m = Object.assign({}, this.info, {history: true});
    return new Db(this.client, this.conn, m);
};

Db.prototype.indexRange = function (m) {
    return this.client.chunkedAsyncOp(this.conn, keyword(':index-range'), this, m);
};

Db.prototype.pull = function (m) {
    return this.client.asyncOp(this.conn, keyword(':pull'), this, m);
};

Db.prototype.since = function(t) {
    let m = Object.assign({}, this.info, {since: t});
    return new Db(this.client, this.conn, m);
};

Db.prototype.with = function (m) {
    return asyncOp(this.client, this.conn, ':with', this, m);
};

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

Connection.prototype.db = function () {
    return new Db(this.client, this, this.getRequestContext());
};

Connection.prototype.log = function () {
    return {log: this.info['database-id']};
};

/**
 * Query the database. Returns a promise that will yield a channel
 * that can be read from to fetch results; in case of error, the promise
 * will be rejected with the error.
 *
 * The argument map must contain the following keys:
 *
 * * query -- the query to run.
 * * args -- arguments to the query.
 *
 * Also supports the following optional keys:
 *
 * * timeout -- query timeout in milliseconds.
 * * offset -- the offset in the result set. Default 0.
 * * limit -- the maximum number of results to read. Default 1000.
 * * chunk -- the maximum number of results to return in each chunk. Default 1000.
 *
 * @param m The argument map.
 * @returns The promise.
 */
Connection.prototype.q = function (m) {
    return this.client.chunkedAsyncOp(this, transit.keyword('q'), this, m);
};

Connection.prototype.sync = function (t) {
    if (typeof t != 'number') {
        throw new Error('t must be a number');
    }
    this.advanceT({t: t});
    return Promise.resolve(this.db());
};

Connection.prototype.txRange = function (m) {
    return this.client.chunkedAsyncOp(this, transit.keyword('tx-range'), this, m);
};

Connection.prototype.transact = function (m) {
    return this.client.asyncOp(this, transit.keyword('transact'), this, m);
};

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

ExpBackoff.prototype.backOff = function () {
    let newValue = this.value * this.factor;
    this.value = newValue;
    if (newValue < this.max) {
        return new Promise(resolve => {
            setTimeout(() => { resolve(null); }, newValue);
        });
    } else {
        return Promise.reject(new Error('retries exhausted'));
    }
};

function LinearBackoff(timeout, count) {
    this.timeout = timeout;
    this.count = count;
}

LinearBackoff.prototype.backOff = function() {
    this.count = this.count - 1;
    if (this.count > 0) {
        let to = this.timeout;
        return new Promise(resolve => {
            setTimeout(() => { resolve(null); }, to);
        });
    } else {
        return Promise.reject(new Error('retries exhausted'));
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
        console.log('signed request: ' + JSON.stringify(signedRequest));
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
        console.log('http status: ' + response.statusCode + ' headers:' + JSON.stringify(response.headers) +
            ' bodyData: ' + response.bodyData);
        let reader = transit.reader('json');
        let body = null;
        if (response.headers['content-type'] === 'application/transit+json') {
            try {
                body = reader.read(response.bodyData);
            } catch (err) {
                console.log('error parsing body: ' + err);
            }
        }
        console.log('read body:' + body);
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
                bBackoff.backOff().then(() => {
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
                        console.log('refrehed sign params', oldSignParams, newSignParams, equal);
                        if (equal) {
                            throw error;
                        } else {
                            return doSendWithRetry(httpRequest, requestContext, spi, timeout, Promise.resolve(newSignParams), uBackoff, bBackoff);
                        }
                    });
                });
            } else if (retryAnom(cat, httpRequest.op)) {
                uBackoff.backOff().then(() => {
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
    console.log('jsToTransit: ' + JSON.stringify(m));
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
                                 Object.assign({}, selectKeys(requester.getRequestContext(), ['databaseId', 'dbName']),
                                               selectKeys(transitToJs(response.get(keyword('db-before'))), dbContextKeys))),
                dbAfter: new Db(this, conn,
                                Object.assign({}, selectKeys(requester.getRequestContext(), ['databaseId', 'dbName']),
                                              selectKeys(transitToJs(response.get(keyword('db-after'))), dbContextKeys))),
                txData: transitToJs(response.get(keyword('tx-data'))),
                tempids: transitToJs(response.get(keyword('tempids')))
            };
        case ':datoms':
        case ':q':
        case ':tx-range':
        case ':index-range':
            return transitToJs(response.get(keyword('data')));
        case ':pull':
        case ':db-stats':
        case ':datomic.catalog/list-dbs':
            console.log(response, response.get(keyword('result')));
            return transitToJs(response.get(keyword('result')));
        case ':with-db':
            return new Db(this, conn,
                Object.assign({}, requester.getRequestContext(), selectKeys(transitToJs(response), dbContextKeys)));
        case ':datomic.catalog/create-db':
        case ':datomic.catalog/delete-db':
            return true;
        default:
            return transitToJs(response);
    }
}

function updateState(conn, response) {
    let dbs = response.get(keyword('dbs'));
    if (conn != null) {
        if (dbs != null) {
            dbs.forEach((db) => {
                if (db.get(keyword('database-id')) === conn.databaseId) {
                    conn.advanceT(db);
                }
            });
        }
    }
}

function convertResponse(conn, op, requester, response, handler) {
    updateState(conn, response);
    return handler(conn, op, requester, response);
}

Client.prototype.asyncOp = function (conn, op, requester, m) {
    let requestContext = requester.getRequestContext();
    let request = apiToClientRequest(op, requestContext, m);
    let httpRequest = clientRequestToHttpRequest(request);
    let routedHttpRequest = this.spi.addRouting(httpRequest);
    m = m || {};
    return sendWithRetry(routedHttpRequest, requestContext, this.spi, m.timeout || 60000).then(
        (result) => {
            return convertResponse(conn, op, requester, result.body, clientResponseToApi);
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
                let nextRequest = Object.assign({}, requestContext,
                    {
                        op: keyword('next'),
                        nextToken: response.get(keyword(nextToken)),
                        offset: nextOffset,
                        chunk: response.get(keyword(chunk))
                    });
                let nextClientRequest = apiToClientRequest(op, requester, nextRequest);
                let nextRoutedRequest = spi.addRouting(nextClientRequest);
                return sendWithRetry(nextRoutedRequest, requestContext, spi, timeout || 60000).then(
                    (result) => {
                        convertChunkedResponse(conn, 'next', requester, result, handler, spi, requestContext, timeout, channel);
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
    let requestContext = requester.getRequestContext();
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
                        console.log('connect done, resolved: ' + JSON.stringify(resolved) + ', status: ' + JSON.stringify(status));
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
        if (!Array.isArray(m.txData)) {
            throw Error('invalid request');
        }
    } else if (op.toString() === ':pull') {
        if (m.eid !== undefined || m.selector !== undefined) {
            throw Error('invalid request');
        }
    } else if (op.toString() === ':datoms') {
        if (['eavt', 'aevt', 'avet', 'vaet'].indexOf(m.index) === -1) {
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
            // fixme, need to pass keywords to transact in tx-data...
            request = transit.map([transit.keyword('tx-id'), transit.uuid(uuid.v4()),
                                   transit.keyword('tx-data'), m.txData]);
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
            let comps = m.components;
            if (comps !== undefined) {
                comps = transit.list(comps.map(
                    function (v) {
                        if (typeof v == 'string' && v[0] === ':') {
                            return transit.keyword(v.slice(1));
                        } else {
                            return v;
                        }
                    }
                ));
            }
            request = transit.map([
                transit.keyword('index'), transit.keyword(m.index),
                transit.keyword('components'), comps
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
                keyword('eid'), m.eid,
                keyword('selector'), convertSelector(m.selector)
            ]);
            break;
    }
    request.set(keyword('op'), keyword(op));
    let requestContext = requester.getRequestContext();
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
