"use strict";

let pro = require('./pro.js');
let cloud = require('./cloud.js');
let shared = require('./shared.js');

function makeSpi(args) {
    switch (args.serverType) {
        case 'client':
        case 'peer-server':
            return pro.createSpi(args);
        case 'cloud':
            return cloud.createSpi(args);
        default:
            throw new Error('unknown server type: ' + args.serverType);
    }
}

function connect(args) {
    return shared.makeConnection(makeSpi(args), args);
}

function listDatabases(args) {
    let client = shared.makeClient(makeSpi(args));
    return client.listDatabases(args);
}

exports.connect = connect;
exports.listDatabases = listDatabases;

exports.uuid = shared.makeUuid;
exports.randomUuid = shared.randomUuid;