let client = require('./src/client.js');

const config = {
    endpoint: 'http://entry.datomic-cloud-dev2.us-west-2.datomic.net:8182/',
    serverType: 'cloud',
    region: 'us-west-2',
    system: 'datomic-cloud-dev2',
    proxyPort: 8182
};

client.listDatabases(config).then(res => console.log(res)).catch(err => console.log(err, err.stack));