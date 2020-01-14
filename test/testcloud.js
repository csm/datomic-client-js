let assert = require('assert');
let client = require('../index.js');
let transit = require('transit-js');
let uuid = require('uuid');

const dbName = 'movies-test-' + uuid.v4();
const system = process.env.CLOUD_SYSTEM;
const region = process.env.CLOUD_REGION;
const proxyPort = Number.parseInt(process.env.CLOUD_PROXY_PORT);

const config = {
    serverType: 'cloud',
    endpoint: 'http://entry.' + system + '.' + region + '.datomic.net:8182/',
    system: system,
    region: region,
    dbName: dbName,
    proxyPort: proxyPort
};

const schema = [
    transit.map([
        transit.keyword('db/ident'), transit.keyword('movie/title'),
        transit.keyword('db/valueType'), transit.keyword('db.type/string'),
        transit.keyword('db/cardinality'), transit.keyword('db.cardinality/one'),
        transit.keyword('db/doc'), 'The title of the movie'
    ]),
    transit.map([
        transit.keyword('db/ident'), transit.keyword('movie/genre'),
        transit.keyword('db/valueType'), transit.keyword('db.type/string'),
        transit.keyword('db/cardinality'), transit.keyword('db.cardinality/one'),
        transit.keyword('db/doc'), 'The genre of the movie'
    ]),
    transit.map([
        transit.keyword('db/ident'), transit.keyword('movie/release-year'),
        transit.keyword('db/valueType'), transit.keyword('db.type/long'),
        transit.keyword('db/cardinality'), transit.keyword('db.cardinality/one'),
        transit.keyword('db/doc'), 'The year the movie was released in theaters'
    ])
];

let connection = null;

// I find myself wondering how you people all live like this, without reasonable equals behavior
// for maps and arrays. But whatever. I'm just a stranger in a strange land.

function equiv(a1, a2) {
    if (Array.isArray(a1) && Array.isArray(a2) && a1.length === a2.length) {
        for (let i in a1) {
            if (a1[i] !== a2[i]) {
                return false;
            }
        }
        return true;
    } else {
        return false;
    }
}

describe('cloud test suite', function() {
    this.timeout(10000);

    before(async function () {
        let createResult = await client.createDatabase(config);
        assert.ok(createResult, 'create database result');
        connection = await client.connect(config);
        await connection.transact({txData: schema});
    });

    after(async function () {
        let deleteResult = await client.deleteDatabase(config);
        assert.ok(deleteResult, 'delete database result');
    });

    describe('#queryScema()', function () {
        it('reads the schema', async function () {
            let query = new client.QueryBuilder().find('?id', '?doc').in('$').where(['?e', 'db/ident', '?id'], ['?e', 'db/doc', '?doc']).build();
            let db = connection.db();
            let chan = await connection.q({query: query, args: [db]});
            let result = await chan.take();
            console.log('result', result);
            assert.ok(equiv(result.find(e => e[0] === 'movie/title'), ['movie/title', 'The title of the movie']));
            assert.ok(equiv(result.find(e => e[0] === 'movie/genre'), ['movie/genre', 'The genre of the movie']));
            assert.ok(equiv(result.find(e => e[0] === 'movie/release-year'), ['movie/release-year', 'The year the movie was released in theaters']));
        });
    });

    const testData = [
        transit.map([
            transit.keyword('movie/title'), "The Goonies",
            transit.keyword('movie/genre'), "action/adventure",
            transit.keyword('movie/release-year'), 1985
        ]),
        transit.map([
            transit.keyword('movie/title'), "Commando",
            transit.keyword('movie/genre'), "thriller/action",
            transit.keyword('movie/release-year'), 1985
        ]),
        transit.map([
            transit.keyword('movie/title'), "Repo Man",
            transit.keyword('movie/genre'), "punk dystopia",
            transit.keyword('movie/release-year'), 1984
        ])
    ];

    describe('#transactAndQuery()', function() {
        it('transacts and queries data', async function() {
            let result = await connection.transact({txData: testData});
            let db = connection.db();
            let chan = await connection.q({
                query: new client.QueryBuilder().find('?title').in('$', '?year').where(['?movie', 'movie/release-year', '?year'], ['?movie', 'movie/title', '?title']).build(),
                args: [db, 1985]
            });
            let titles85 = await chan.take();
            console.log('query result:', titles85);
            assert.ok(Array.isArray(titles85));
            assert.equal(2, titles85.length);
            assert.ok(Array.isArray(titles85[0]));
            assert.ok(Array.isArray(titles85[1]));
            assert.equal(1, titles85[0].length);
            assert.equal(1, titles85[1].length);
            let titles = titles85.map(v => { return v[0]; });
            assert.ok(titles.indexOf('The Goonies') >= 0);
            assert.ok(titles.indexOf('Commando') >= 0);
        });
    });
});