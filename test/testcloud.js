let assert = require('assert');
let client = require('../index.js');
let uuid = require('uuid');
let common = require('./common.js');

const dbName = 'movies-test-' + uuid.v4();
const system = process.env.CLOUD_SYSTEM;
const region = process.env.CLOUD_REGION;
let proxyPort = -1;
if (process.env.CLOUD_PROXY_PORT != null) {
    proxyPort = Number.parseInt(process.env.CLOUD_PROXY_PORT);
}
let endpoint = `http://entry.${system}.${region}.datomic.net:8182/`;
if (process.env.CLOUD_ENDPOINT != null) {
    endpoint = process.env.CLOUD_ENDPOINT;
}

const config = {
    serverType: 'cloud',
    endpoint: endpoint,
    system: system,
    region: region,
    dbName: dbName,
};
if (proxyPort != -1) {
    config.proxyPort = proxyPort;
}

describe('cloud test suite', common.testSuite(
    async function(schema) {
        let createResult = await client.createDatabase(config);
        assert.ok(createResult, 'create database result');
        // wait for the database to be created, so we can connect.
        await new Promise(resolve => setTimeout(() => resolve(null), 1000));
        let connection = await client.connect(config);
        await connection.transact({txData: schema});
        return connection;
    },
    async function() {
        let deleteResult = await client.deleteDatabase(config);
        assert.ok(deleteResult, 'delete database result');
    }, config
));