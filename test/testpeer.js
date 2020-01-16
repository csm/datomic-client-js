let assert = require('assert');
let client = require('../index.js');
let transit = require('transit-js');
let path = require('path');
let child_process = require('child_process');
let net = require('net');
let uuid = require('uuid');
let common = require('./common');
let jsedn = require('jsedn');

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
        let proc = child_process.spawn(run, args, {env: {'JAVA_HOME': javaHome}, detached: true}, (err, stdout, stderr) => {
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

describe('peer-server test suite', common.testSuite(
    async function(schema) {
        await createDb();
        peerServerProc = await peerServer();
        let connection = await client.connect(config);
        let schema2 = jsedn.parse(jsedn.encode(schema));
        schema2.val[0].keys.push(jsedn.parse(':db/index'));
        schema2.val[0].vals.push(true);
        await connection.transact({txData: schema2});
        return connection;
    },
    async function() {
        await deleteDb();
        console.log('deleted database');
        if (peerServerProc != null) {
            process.kill(-peerServerProc.pid);
        } else {
            console.log('no proc to kill, kill this program yourself');
        }
    }, config
));