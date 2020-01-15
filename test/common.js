let client = require('../index.js');
let assert = require('assert');

const schema = new client.TxBuilder().txData(
    {
        'db/ident': 'movie/title',
        'db/valueType': 'db.type/string',
        'db/cardinality': 'db.cardinality/one',
        'db/doc': 'The title of the movie'
    },
    {
        'db/ident': 'movie/genre',
        'db/valueType': 'db.type/string',
        'db/cardinality': 'db.cardinality/one',
        'db/doc': 'The genre of the movie'
    },
    {
        'db/ident': 'movie/release-year',
        'db/valueType': 'db.type/long',
        'db/cardinality': 'db.cardinality/one',
        'db/doc': 'The year the movie was released in theaters'
    }
).build();

const testData = new client.TxBuilder().txData(
    {
        'movie/title': "The Goonies",
        'movie/genre': "action/adventure",
        'movie/release-year': 1985
    },
    {
        'movie/title': "Commando",
        'movie/genre': "thriller/action",
        'movie/release-year': 1985
    },
    {
        'movie/title': "Repo Man",
        'movie/genre': "punk dystopia",
        'movie/release-year': 1984
    }
).build();

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

function testSuite(beforeFn, afterFn) {
    return function() {
        this.timeout(30000);
        let connection = null;

        before(async function () {
            connection = await beforeFn(schema);
        });

        after(async function() {
            afterFn();
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
    }
}

exports.testSuite = testSuite;