"use strict";

let pro = require('./pro.js');
let cloud = require('./cloud.js');
let shared = require('./shared.js');
let transit = require('transit-js');

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

const AVET = transit.keyword('avet');
const AEVT = transit.keyword('aevt');
const EAVT = transit.keyword('eavt');
const VAET = transit.keyword('vaet');

exports.AVET = AVET;
exports.AEVT = AEVT;
exports.EAVT = EAVT;
exports.VAET = VAET;

exports.connect = connect;
exports.listDatabases = listDatabases;

exports.uuid = shared.makeUuid;
exports.randomUuid = shared.randomUuid;