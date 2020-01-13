'use strict';

function routingMap(endpoint) {
    let parts = endpoint.split(':', 2);
    let host = parts[0];
    let port = 443;
    if (parts.length > 1) {
        port = Number.parseInt(parts[1]);
    }
    return {
        headers: {host: host},
        scheme: "https",
        hostname: host,
        port: port,
        uri: '/'
    };
}

function Spi(signingMap, routingMap) {
    this.signingMap = signingMap;
    this.routingMap = routingMap;
}

Spi.prototype.addRouting = function(request) {
    let headers = Object.assign({}, this.routingMap.headers, request.headers || {});
    let routed =  Object.assign({}, this.routingMap, request);
    routed.headers = headers;
    return routed;
};

Spi.prototype.getSignParams = function() {
    return this.signingMap;
};

Spi.prototype.refreshSignParams = function() {
    return Promise.resolve(this.signingMap);
};

Spi.prototype.getAgent = function() {
    return null;
};

function createSpi(args) {
    if (args.accessKey != null && args.endpoint != null) {
        let routing = routingMap(args.endpoint);
        let signParams = {
            accessKey: args.accessKey,
            secret: args.secret,
            service: "peer-server",
            region: "none"
        };
        return new Spi(signParams, routing);
    } else {
        throw Error('invalid connection config');
    }
}

exports.createSpi = createSpi;