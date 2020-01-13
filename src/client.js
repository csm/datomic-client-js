"use strict";

let pro = require('./pro.js');
let cloud = require('./cloud.js');
let shared = require('./shared.js');
let transit = require('transit-js');

function makeSpi(args) {
    switch (args.serverType) {
        case 'client':
        case 'peer-server':
            return Promise.resolve(pro.createSpi(args));
        case 'cloud':
        case 'ion':
            return cloud.createSpi(args);
        default:
            throw new Error('unknown server type: ' + args.serverType);
    }
}

async function connect(args) {
    let spi = await makeSpi(args);
    let conn = await shared.makeConnection(spi, args);
    return conn;
}

async function listDatabases(args) {
    let spi = await makeSpi(args);
    let client = await shared.makeClient(spi);
    let dbs = await client.listDatabases(args);
    return dbs;
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