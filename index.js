'use strict';

let jsedn = require('jsedn');
module.exports = Object.assign({edn: (s) => jsedn.parse(s[0])}, require('./src/client.js'), require('./src/query.js'), require('./src/tx.js'));