"use strict";

function createAccessKeyId(args) {
    if (args.type === 'admin') {

    } else if (args.type === 'catalog-read') {

    } else if (args.type === 'db-read') {

    }
}

function createSpi(args) {
    throw new Error('not yet implemented');
}

exports.createSpi = createSpi;