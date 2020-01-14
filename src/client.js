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
    return await shared.makeConnection(spi, args);
}

async function listDatabases(args) {
    let spi = await makeSpi(args);
    let c = await shared.makeClient(spi);
    return await c.listDatabases(args);
}

async function createDatabase(args) {
    if (args.serverType === 'client' || args.serverType === 'peer-server') {
        throw new Error('peer-server does not support createDatabase');
    }
    let spi = await makeSpi(args);
    let c = await shared.makeClient(spi);
    return c.createDatabase(args);
}

async function deleteDatabase(args) {
    if (args.serverType === 'client' || args.serverType === 'peer-server') {
        throw new Error('peer-server does not support createDatabase');
    }
    let spi = await makeSpi(args);
    let c = await shared.makeClient(spi);
    return c.deleteDatabase(args);
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
exports.createDatabase = createDatabase;
exports.deleteDatabase = deleteDatabase;

exports.uuid = shared.makeUuid;
exports.randomUuid = shared.randomUuid;