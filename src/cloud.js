"use strict";

let aws = require('aws-sdk');
let http = require('http');
let https = require('https');
let SocksProxyAgent = require('socks-proxy-agent');
let transit = require('transit-js');
let url = require('url');

function createAccessKeyIdForType(args) {
    if (args.type === 'admin') {
        return args.prefix + '/' + args.system + '/datomic/access/admin/' + args.keyName;
    } else if (args.type === 'catalog-read') {
        return args.prefix + '/' + args.system + '/datomic/access/dbs/catalog/read/' + args.keyName;
    } else if (args.type === 'db-read') {
        return args.prefix + '/' + args.system + '/datomic/access/dbs/db/' + args.dbName + '/read/' + args.keyName;
    } else if (args.type === 'db-write') {
        return args.prefix + '/' + args.system + '/datomic/access/dbs/db/' + args.dbName + '/' + args.keyName;
    } else {
        return null;
    }
}

const opToAccessKeyType = {
    'datomic.catalog/administer-system':   'admin',
    'datomic.catalog/list-dbs':            'catalog-read',
    'datomic.catalog/create-db':           'admin',
    'datomic.catalog/delete-db':           'admin',
    'datomic.client.protocol/q':           'db-read',
    'datomic.client.protocol/next':        'db-read',
    'datomic.catalog/resolve-db':          'db-read',
    'datomic.client.protocol/status':      'db-read',
    'datomic.client.protocol/datoms':      'db-read',
    'datomic.client.protocol/index-range': 'db-read',
    'datomic.client.protocol/pull':        'db-read',
    'datomic.client.protocol/db-stats':    'db-read',
    'datomic.client.protocol/tx-range':    'db-read',
    'datomic.client.protocol/transact':    'db-write',
    'datomic.client.protocol/with-db':     'db-read',
    'datomic.client.protocol/with':        'db-read'
};

const accessKeyIdPattern = new RegExp('(s3://(.+))/([^/]+)');

function createAccessKeyId(keyfileName, keyName) {
    let res = accessKeyIdPattern.exec(keyfileName);
    if (res != null) {
        return res[1] + '/' + keyName;
    } else {
        return null;
    }
}

function baseAccessKeyId(config, requestContext, request) {
    let op = request.headers['x-nano-op'];
    let type = opToAccessKeyType[op];
    if (type != null) {
        return createAccessKeyIdForType({
            type: type,
            prefix: config.s3AuthPath,
            system: config.system,
            keyName: 'dummy',
            dbName: requestContext.dbName
        });
    } else {
        return null;
    }
}

function Spi(config, routingMap, agent) {
    this.config = config;
    this.routingMap = routingMap;
    this._cachedKeys = {};
    this.agent = agent;
}

Spi.prototype.addRouting = function (request) {
    let headers = Object.assign({}, this.routingMap.headers, request.headers || {});
    let routed =  Object.assign({}, this.routingMap, request);
    routed.headers = headers;
    return routed;
};

Spi.prototype.getSignParams = function(request, address) {
    let baseKeyId = baseAccessKeyId(this.config, address, request);
    let res = this._cachedKeys[baseKeyId];
    if (res != null) {
        return signParams(this.config, res);
    } else {
        return null;
    }
};

Spi.prototype.refreshSignParams = async function(request, address) {
    let baseKeyId = baseAccessKeyId(this.config, address, request);
    let parsedKeyId = parseAccessKeyId(baseKeyId);
    if (parsedKeyId != null) {
        let keyfile = await getKeyFile(this.config, parsedKeyId.keyfileName);
        let creds = currentCreds(parsedKeyId, keyfile);
        if (creds != null) {
            this._cachedKeys[baseKeyId] = creds;
            return signParams(this.config, creds);
        } else {
            throw Error('failed to refresh keys')
        }
    } else {
        return null;
    }
};

Spi.prototype.getAgent = function () {
    return this.agent;
};

let shared = require('./shared');
function signParams(config, creds) {
    return {
        service: 'datomic',
        region: config.region,
        accessKey: creds.accessKeyId,
        secret: creds.creds.secret
    }
}

const currentKey = transit.keyword('current');
const keyName = transit.keyword('key-name');
const secret = transit.keyword('secret');

function currentCreds(parsedKeyId, keyfile) {
    let current = keyfile.get(currentKey);
    if (current != null) {
        return {
            accessKeyId: createAccessKeyId(parsedKeyId.keyfileName, current.get(keyName)),
            creds: {
                keyName: current.get(keyName),
                secret: current.get(secret)
            }
        };
    }
}

const keyPat = new RegExp('(s3://(.+))/([^/]+)');
function parseAccessKeyId(s) {
    let matched = keyPat.exec(s);
    if (matched != null) {
        return {
            keyfileName: matched[1] + '/.keys',
            keyName: matched[3]
        };
    } else {
        return null;
    }
}

async function getKeyFile(config, s3url) {
    let s3 = new aws.S3({region: config.region});
    let u = url.parse(s3url);
    let request = {
        Bucket: u.hostname,
        Key: u.path.replace(/^\/+/, '')
    };
    let result = await s3.getObject(request).promise();
    let reader = transit.reader('json');
    return reader.read(result.Body);
}

const DEFAULT_HTTP_PORT = 80;
const DEFAULT_HTTPS_PORT = 443;

function parseEndpoint(s) {
    if (s != null) {
        let uri = url.parse(s);
        let protocol;
        if (uri.protocol === 'http:') {
            protocol = 'http';
        } else {
            protocol = 'https';
        }
        let port = uri.port;
        if (port == null) {
            if (uri.protocol === 'http') {
                port = DEFAULT_HTTP_PORT;
            } else if (uri.protocol === 'https') {
                port = DEFAULT_HTTPS_PORT;
            }
        } else {
            port = Number.parseInt(port);
        }
        let host = uri.hostname;
        let hostheader = host;
        if (protocol === 'http' && port !== DEFAULT_HTTP_PORT) {
            hostheader = host + ':' + port;
        } else if (protocol === 'https' && port !== DEFAULT_HTTPS_PORT) {
            hostheader = host + ':' + port;
        }
        let res = {
            scheme: protocol,
            headers: {host: hostheader},
            hostname: host,
            port: port
        };
        return res;
    } else {
        return null;
    }
}

const s3PathPat = /{:s3-auth-path "(.*)"}/;
function getS3AuthPath(request, agent) {
    return new Promise((resolve, reject) => {
        let req = null;
        let handle = function(res) {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                let parts = s3PathPat.exec(data);
                if (parts != null) {
                    resolve(parts[1]);
                } else {
                    reject(new Error('failed to read s3 auth path'));
                }
            });
        };
        if (agent != null) {
            request.agent = agent;
        }
        if (request.scheme === 'http') {
            req = http.request(request, handle);
        } else {
            req = https.request(request, handle);
        }
        req.on('error', reject);
        req.end();
    });
}

async function createSpi(args) {
    args = Object.assign({}, args, {endpointMap: parseEndpoint(args.endpoint)});
    let agent = null;
    if (args.proxyPort != null) {
        agent = new SocksProxyAgent({
            protocol: 'socks5h:',
            host: '127.0.0.1',
            port: args.proxyPort
        });
    }
    let s3Path = await getS3AuthPath(Object.assign({}, args.endpointMap,{method: 'get', path: '/'}), agent);
    let spiArgs = Object.assign(args, {s3AuthPath: 's3://' + s3Path});
    spiArgs.endpointMap.path = '/api';
    return new Spi(spiArgs, spiArgs.endpointMap, agent);
}

exports.createSpi = createSpi;