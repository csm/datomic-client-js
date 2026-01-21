'use strict';

/**
 * TLS validation modes for peer-server connections:
 * - 'strict': Full certificate validation including expiration and CA chain
 * - 'allow-expired': Validate CA chain but allow expired certificates (default)
 * - 'none': Disable all certificate validation (not recommended)
 */
const TLS_VALIDATION_MODES = ['strict', 'allow-expired', 'none'];

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

function Spi(signingMap, routingMap, tlsConfig) {
    this.signingMap = signingMap;
    this.routingMap = routingMap;
    this.serverType = 'peer-server';
    this.tlsConfig = tlsConfig;
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

Spi.prototype.usePrivateTrustAnchor = function () {
    // Use private trust anchor unless user provided their own CA with strict validation
    return this.tlsConfig.validation !== 'strict' || !this.tlsConfig.ca;
}

Spi.prototype.getTlsConfig = function () {
    return this.tlsConfig;
}

function createSpi(args) {
    if (args.accessKey != null && args.endpoint != null) {
        let routing = routingMap(args.endpoint);
        let signParams = {
            accessKey: args.accessKey,
            secret: args.secret,
            service: "peer-server",
            region: "none"
        };
        let tlsValidation = args.tlsValidation || 'allow-expired';
        if (TLS_VALIDATION_MODES.indexOf(tlsValidation) === -1) {
            throw Error(`invalid tlsValidation mode: ${tlsValidation}. Must be one of: ${TLS_VALIDATION_MODES.join(', ')}`);
        }
        let tlsConfig = {
            validation: tlsValidation,
            ca: args.tlsCa || null
        };
        return new Spi(signParams, routing, tlsConfig);
    } else {
        throw Error('invalid connection config');
    }
}

exports.createSpi = createSpi;
exports.TLS_VALIDATION_MODES = TLS_VALIDATION_MODES;