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

/**
 * Connect to a Datomic database. Takes an object of arguments,
 * required arguments are:
 *
 * <ul>
 *     <li>serverType: either 'cloud' (alias 'ion') or 'peer-server' (alias 'client').</li>
 *     <li>dbName: the database name to connect to.
 * </ul>
 *
 * For the 'cloud' serverType, additional arguments include:
 *
 * <ul>
 *     <li>system: Your cloud system name. Required.</li>
 *     <li>region: Your AWS region. Required.</li>
 *     <li>endpoint: Your cloud entry URL. Required.</li>
 *     <li>proxyPort: The socks proxy port to use (on localhost), when using the bastion server. Optional.</li>
 * </ul>
 *
 * For the 'peer-server' serverType, additional arguments include:
 *
 * <ul>
 *     <li>endpoint: The peer-server endpoint. Required.</li>
 *     <li>accessKey: Your access key. Required.</li>
 *     <li>secret: Your secret. Required.</li>
 * </ul>
 *
 * @param args The arguments.
 * @returns {Promise<*>} The promise that will yield the connection, or an error.
 */
async function connect(args) {
    let spi = await makeSpi(args);
    return await shared.makeConnection(spi, args);
}

/**
 * List databases in your system.
 *
 * The arguments are the same as {@link #connect}, except omit the dbName parameter.
 *
 * @param args The arguments.
 * @returns {Promise<*>} The promise that will yield an array of database names (strings),
 *   or an error.
 */
async function listDatabases(args) {
    let spi = await makeSpi(args);
    let c = await shared.makeClient(spi);
    return await c.listDatabases(args);
}

/**
 * Create a new database (only supported with cloud).
 *
 * The arguments are the same as those passed to {@link #connect}.
 *
 * @param args
 * @returns {Promise<boolean>} The promise that will yield true when the
 *   database is created, or yields an error.
 */
async function createDatabase(args) {
    if (args.serverType === 'client' || args.serverType === 'peer-server') {
        throw new Error('peer-server does not support createDatabase');
    }
    let spi = await makeSpi(args);
    let c = await shared.makeClient(spi);
    return c.createDatabase(args);
}

/**
 * Delete a database (only supported with cloud).
 *
 * The arguments are the same as those passed to {@link @connect}.
 *
 * @param args
 * @returns {Promise<boolean>} The promise that will yield true when the
 *   database is deleted, or yields an error.
 */
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