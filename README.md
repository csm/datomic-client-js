# datomic-client-js

[![npm version](https://badge.fury.io/js/datomic-client-js.svg)](https://badge.fury.io/js/datomic-client-js)

Work in progress!

[API docs](https://csm.github.io/datomic-client-js/)

A JavaScript (node, maybe browser) client for [Datomic](https://datomic.com)
peer server and cloud.

Some example usage:

```javascript
// peer-server config map example
let peerConf = {
    serverType: 'peer-server',
    endpoint: 'localhost:8001',
    dbName: 'your-db-name',
    accessKey: 'your-access-key',
    secret: 'your-secret'
};

// cloud config map example
let cloudConf = {
    endpoint: 'http://entry.your-system-name.your-region.datomic.net:8182/',
    serverType: 'cloud',
    region: 'your-region',
    system: 'your-system',
    dbName: 'your-db-name',
    proxyPort: 8182  // if connecting via the bastion server
};

let client = require('datomic-client-js');

// List databases, you can omit dbName from config
client.listDatabases(cloudConf).then((dbs) => `${dbs}`);

// Create database (cloud only)
client.createDatabase(cloudConf).then((success) => `${success}`);

// Define for edn string literals (or you can just use jsedn functions).
let edn = client.edn;

// Connect to a database
client.connect(cloudConf).then(async function(connection) {
    // transact a schema
    let schema = edn`[{:db/ident :movie/title,
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
                       :db/doc "The year the movie was released in theaters"}]`;
    await connection.transact({txData: schema});
    
    // transact some data
    let testData = edn`[{:movie/title "The Goonies",
                         :movie/genre "action/adventure",
                         :movie/release-year 1985},
                        {:movie/title "Commando",
                         :movie/genre "thriller/action",
                         :movie/release-year 1985},
                        {:movie/title "Repo Man",
                         :movie/genre "punk dystopia",
                         :movie/release-year 1984}]`;
    await connection.transact({txData: testData});

    // Query the database
    let query = edn`[:find ?movie ?title
                     :in $ ?year
                     :where [?movie :movie/release-year ?year]
                     [?movie :movie/title ?title]]`;
    let db = connection.db();
    // Chunked operations (q, indexRange, datoms, txRange) return a channel that yields
    // promises of async values.
    let chan = await connection.q({query: query, args: [db, 1985]});
    let result = await chan.take();
    
    // Pull an entity
    let id = result[0][0];
    let pulled = await db.pull({
        eid: id,
        selector: edn`[:movie/title :movie/genre :movie/release-year]`    
    });
    return pulled;
});
```

## Status

* Basic communications work, to the point where I can make a basic query.
* SPI support for on-prem peer-server.
* SPI support for cloud.
* Some query builder support complete.
* Some transaction builder support complete.
* EDN queries or transaction data supported.
* Some tests written.

## TODO

* More builder support for queries.
* API docs.
* Package everything properly for external consumption (i.e. I don't really know how to package up JavaScript).
* More tests.