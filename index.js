'use strict';

let jsedn = require('jsedn');

function edn(s, ...args) {
    let ednStr = '';
    for (let i = 0; i < s.length || i < args.length; i++) {
        if (i < s.length) {
            ednStr += s[i];
        }
        if (i < args.length) {
            ednStr += args[i];
        }
    }
    return jsedn.parse(ednStr);
}

module.exports = Object.assign({edn: edn}, require('./src/client.js'), require('./src/query.js'), require('./src/tx.js'));