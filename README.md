# datomic-client-js

Work in progress!

A JavaScript (node, maybe browser) client for [Datomic](https://datomic.com)
peer server and (eventually) cloud.

Example:

```javascript
let client = require('./src/client.js');
let query = require('./src/query.js');

const q = new q.QueryBuilder().find('?id', '?doc')
    .in('$')
    .where(['?e', 'db/ident', '?id'], ['?e', 'db/doc', '?doc'])
    .build();

async function testq() {
    let conn = await client.connect({
        serverType: 'client', endpoint: 'localhost:8001', dbName: 'db-name', accessKey: 'access-key', secret: 'secret'
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

## Status

* Basic communications work, to the point where I can make a basic query.
* SPI support for on-prem peer-server.
* Some query builder support complete.

## TODO

* More builder support for queries.
* Add builder support for transactions?
* SPI for cloud.
* API docs.
* Package everything properly for external consumption.
* Uh, tests?