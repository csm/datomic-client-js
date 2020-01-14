let assert = require('assert');
let client = require('../index.js');
let transit = require('transit-js');
let path = require('path');
let child_process = require('child_process');
let net = require('net');
let uuid = require('uuid');

const dbName = 'movies-test-' + uuid.v4();
const accessKey = 'test';
const secret = 'test';
const datomicProHome = process.env.DATOMIC_PRO_HOME;
const javaHome = process.env.JAVA_HOME;

const config = {
    serverType: 'client',
    accessKey: accessKey,
    secret: secret,
    dbName: dbName
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

// Peer server doesn't support create-database or delete-database.
// Use datomic tools to run a script to perform the create/delete.

function doExec(command) {
    return new Promise((resolve, reject) => {
        let completed = false;
        let proc = child_process.exec(command, {env: {'PEER_DB_NAME': dbName, 'JAVA_HOME': javaHome}}, (error, stdout, stderr) => {
            if (error != null) {
                reject(error);
            }
        });
        proc.on('error', () => {
            if (!completed) {
                completed = true;
                reject('failed to launch createDb script');
            }
        });
        proc.on('exit', (code, signal) => {
            if (!completed) {
                if (code === 0) {
                    resolve('ok');
                } else {
                    reject({code: code, signal: signal});
                }
                completed = true;
            }
        });
    });
}

function createDb() {
    let script = path.resolve('./test/create-db.clj');
    let run = path.resolve(datomicProHome, 'bin', 'run');
    return doExec(run + ' ' + script);
}

function deleteDb() {
    let script = path.resolve('./test/delete-db.clj');
    let run = path.resolve(datomicProHome, 'bin', 'run');
    return doExec(run + ' ' + script);
}

function randomPort() {
    let srv = net.createServer(s => s.end(''));
    return new Promise((resolve, reject) => {
        srv.listen(0, () => {
            let port = srv.address().port;
            srv.close(err => {
                if (err != null) {
                    reject(err);
                } else {
                    resolve(port);
                }
            });
        });
    });
}

async function peerServer() {
    let port = await randomPort();
    config.endpoint = 'localhost:' + port;
    let run = path.resolve(datomicProHome, 'bin', 'run');
    return new Promise((resolve, reject) => {
        let args = ['-m', 'datomic.peer-server', '-h', '127.0.0.1', '-p', port.toString(), '-a', accessKey + ',' + secret, '-d', dbName + ',datomic:dev://localhost:4334/' + dbName];
        let proc = child_process.spawn(run, args, {env: {'JAVA_HOME': javaHome}}, (err, stdout, stderr) => {
            if (err) {
                console.log('failed to launch peer server output:', stdout, 'error:', stderr);
                reject(err);
            }
        });
        proc.stdout.on('data', s => {
            if (s instanceof Buffer && s.toString('utf8').startsWith('Serving')) {
                resolve(proc);
            }
        });
    });
}

let peerServerProc = null;

describe('peer-server test suite', function() {
    this.timeout(30000);

    before(async function () {
        await createDb();
        peerServerProc = await peerServer();
        connection = await client.connect(config);
        await connection.transact({txData: schema});
    });

    after(async function () {
        await deleteDb();
        if (peerServerProc != null) {
            if (!peerServerProc.kill()) {
                console.log('kill failed, kill this program yourself');
            }
        } else {
            console.log('no proc to kill, kill this program yourself');
        }
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