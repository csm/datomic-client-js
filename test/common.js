let client = require('../index.js');
let assert = require('assert');

let edn = client.edn;

const schema = edn`
[{:db/ident :movie/title,
  :db/valueType :db.type/string,
  :db/cardinality :db.cardinality/one,
  :db/doc "The title of the movie"},
 {:db/ident :movie/genre,
  :db/valueType :db.type/string,
  :db/cardinality :db.cardinality/one,
  :db/doc "The genre of the movie"},
 {:db/ident :movie/release-year,
  :db/valueType :db.type/long,
  :db/cardinality :db.cardinality/one,
  :db/doc "The year the movie was released in theaters"}]
`;

const testData = edn`
[{:movie/title "The Goonies",
  :movie/genre "action/adventure",
  :movie/release-year 1985},
 {:movie/title "Commando",
  :movie/genre "thriller/action",
  :movie/release-year 1985},
 {:movie/title "Repo Man",
  :movie/genre "punk dystopia",
  :movie/release-year 1984}]
`;

function equiv(a1, a2) {
    if (Array.isArray(a1) && Array.isArray(a2) && a1.length === a2.length) {
        for (let i = 0; i < a1.length; i++) {
            if (a1[i] !== a2[i]) {
                return false;
            }
        }
        return true;
    } else {
        return false;
    }
}

function testSuite(beforeFn, afterFn, config) {
    return function() {
        this.timeout(60000);
        let connection = null;

        before(async function () {
            connection = await beforeFn(schema);
        });

        after(async function() {
            afterFn();
        });

        describe("#listDatabases", function () {
            it("lists databases", async function() {
                let dbList = await client.listDatabases(config);
                assert.ok(Array.isArray(dbList));
                assert.ok(dbList.indexOf(config.dbName) >= 0);
            })
        });

        describe('#queryScema()', function () {
            it('reads the schema', async function () {
                let query = edn`
                [:find ?id ?doc
                 :in $
                 :where [?e :db/ident ?id] [?e :db/doc ?doc]]`;
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
                    query: edn`
                    [:find ?title
                     :in $ ?year
                     :where [?movie :movie/release-year ?year] [?movie :movie/title ?title]]`,
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

        describe("#datoms", function () {
            it("reads eavt index", async function() {
                let db = connection.db();
                let chan = await db.datoms({index: client.EAVT, chunk: 10, limit: 100});
                let chunkCount = 0;
                let datomCount = 0;
                let chunk = null;
                while ((chunk = await chan.take()) != null) {
                    chunkCount++;
                    datomCount += chunk.length;
                }
                assert.equal(10, chunkCount);
                assert.equal(100, datomCount);
            });
        });

        describe("#indexRange", function () {
            it("reads indexRange", async function() {
                let db = connection.db();
                let chan = await db.indexRange({
                    attrid: 'movie/title'
                });
                let result = await chan.take();
                assert.equal(3, result.length);
            });
        });

        describe("#dbStats", function () {
            it("reads database stats", async function() {
                let db = connection.db();
                let stats = await db.dbStats();
                console.log('read db stats:', stats);
                assert.equal('object', typeof stats);
                assert.ok(stats.datoms != null);
            });
        });

        describe("#txRange", function () {
            it("reads tx range", async function () {
                let chan = await connection.txRange({});
                let result = null;
                let count = 0;
                while ((result = await chan.take()) != null) {
                    count++;
                }
                assert.ok(count > 0);
            })
        });

        describe("#pull", function() {
            it("pulls data from the DB", async function() {
                let db = connection.db();
                let chan = await connection.q({
                    query: edn`[:find ?id :in $ ?title :where [?id :movie/title ?title]]`,
                    args: [db, 'Repo Man']
                });
                let result = await chan.take();
                let id = result[0][0];
                let pulled = await db.pull({
                    eid: id,
                    selector: edn`[:movie/title :movie/genre :movie/release-year]`
                });
                assert.equal('Repo Man', pulled['movie/title']);
                assert.equal('punk dystopia', pulled['movie/genre']);
                assert.equal(1984, pulled['movie/release-year']);
            });
        });
    }
}

exports.testSuite = testSuite;