# datomic-client-js

Work in progress!

A JavaScript (node, maybe browser) client for [Datomic](https://datomic.com)
peer server and (eventually) cloud.

Example connecting to peer-server:

```javascript
let client = require('datomic-client-js');

const q = new client.QueryBuilder().find('?id', '?doc')
    .in('$')
    .where(['?e', 'db/ident', '?id'], ['?e', 'db/doc', '?doc'])
    .build();

async function testq() {
    let conn = await client.connect({
        serverType: 'client',
        endpoint: 'localhost:8001',
        dbName: 'db-name',
        accessKey: 'access-key',
        secret: 'secret'
    });
    let db = conn.db();
    let chan = await conn.q({
        query: q,
        args: [db]
    });
    let result = null;
    while ((result = await chan.take()) != null) {
        console.log('got query response:' + JSON.stringify(result));
    }
}

testq().then(_ => console.log('done'));
```

Cloud example:

```javascript
let client = require('datomic-client-js');

const config = {
    endpoint: 'http://entry.<system>.<region>.datomic.net:8182/',
    serverType: 'cloud',
    region: '<region>',
    system: '<system>',
    proxyPort: 8182
};

client.listDatabases(config).then(res => console.log(res)).catch(err => console.log(err, err.stack));
```

## Status

* Basic communications work, to the point where I can make a basic query.
* SPI support for on-prem peer-server.
* SPI support for cloud.
* Some query builder support complete.

## TODO

* More builder support for queries.
* Add builder support for transactions?
* API docs.
* Package everything properly for external consumption.
* Uh, tests?