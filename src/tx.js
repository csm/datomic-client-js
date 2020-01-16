'use strict';

let transit = require('transit-js');
let shared = require('./shared.js');

/**
 * A transaction builder.
 *
 * @deprecated Use EDN template strings instead.
 *
 * @constructor TxBuilder
 */
function TxBuilder() {
    this._txes = [];
}

function convertE(e) {
    if (typeof e == 'string') {
        if (/[0-9]+/.exec(e) != null) {
            return transit.bigInt(e);
        } else {
            return e;
        }
    } else if (typeof e == 'number') {
        return Math.floor(e);
    } else if (e instanceof shared.BigInt) {
        return transit.bigInt(e.rep);
    } else if (Array.isArray(e) && e.length === 2) {
        return [transit.keyword(e[0]), convertV(e[1])];
    } else if (transit.isInteger(e)) {
        return e;
    } else {
        throw new Error('failed to convert value to entity: ' + e);
    }
}

function convertV(v) {
    if (v instanceof shared.UUID) {
        return transit.uuid(v.rep);
    } else if (v instanceof shared.BigInt) {
        return transit.bigInt(v.rep);
    } else if (v instanceof shared.BigDec) {
        return transit.bigDec(v.rep);
    } else if (Array.isArray(v)) {
        return v.map(convertV);
    } else if (typeof v == 'object') {
        return convertMap(v);
    } else {
        return v;
    }
}

function convertMap(obj) {
    let result = transit.map();
    for (let k in obj) {
        if (obj.hasOwnProperty(k)) {
            let ks = k.toString();
            if (ks === 'db/id' || ks === ':db/id') {
                result.set(keyword(k), convertE(obj[k]));
            } else if (
                ks === 'db/ident' || ks === ':db/ident' ||
                ks === 'db/valueType' || ks === ':db/valueType' ||
                ks === 'db/cardinality' || ks === ':db/cardinality' ||
                ks === 'db/unique' || ks === ':db/unique'
            ) {
                result.set(keyword(k), keyword(obj[k]));
            } else {
                result.set(keyword(k), convertV(obj[k]));
            }
        }
    }
    return result;
}

/**
 * Append map transaction data to this transaction.
 *
 * @param objs Objects that contain the transaction data.
 * @returns {TxBuilder} This instance.
 */
TxBuilder.prototype.txData = function(...objs) {
    objs.forEach((o) => this._txes.push(convertMap(o)));
    return this;
};

/**
 * Add a fact to the transaction.
 *
 * @param e {String|Number|shared.BigInt|Array} The entity.
 * @param a {String} The attribute.
 * @param v {*} The value.
 * @returns {TxBuilder} This instance.
 */
TxBuilder.prototype.add = function(e, a, v) {
    this._txes.push([transit.keyword('db/add'), convertE(e), keyword(a), convertV(v)]);
    return this;
};

/**
 * Retract a fact from the transaction.
 *
 * @param e {String|Number|shared.BigInt|Array} The entity.
 * @param a {String} The attribute.
 * @param v {*} The value.
 * @returns {TxBuilder} This instance.
 */
TxBuilder.prototype.retract = function(e, a, v) {
    this._txes.push([transit.keyword('db/retract'), convertE(e), keyword(a), convertV(v)]);
    return this;
};

/**
 * Retract an entity.
 *
 * @param e {String|Number|shared.BigInt|Array} The entity.
 * @returns {TxBuilder} This instance.
 */
TxBuilder.prototype.retractEntity = function(e) {
    this._txes.push([transit.keyword('db/retractEntity'), convertE(e)]);
    return this;
};

/**
 * Add a compare-and-set operation.
 *
 * @param e {String|Number|shared.BigInt|Array} The entity.
 * @param a {String} The attribute.
 * @param expVal {*} The expected value (to swap out).
 * @param newVal {*} The new value (to swap in).
 * @returns {TxBuilder} This instance.
 */
TxBuilder.prototype.cas = function(e, a, expVal, newVal) {
    this._txes.push([transit.keyword('db/cas'), convertE(e), keyword(a), convertV(expVal), convertV(newVal)]);
    return this;
};

/**
 * Add an arbitrary transaction function call.
 *
 * Note that if you intend to pass symbols or keywords to your transaction
 * function, you must convert those arguments to that type before you pass
 * those arguments to this function.
 *
 * @param functionName {String} The function name.
 * @param args {*} The arguments.
 * @returns {TxBuilder} This instance.
 */
TxBuilder.prototype.txFunction = function(functionName, ...args) {
    let list = [transit.symbol(functionName)];
    this._txes.push(list.concat(args));
    return this;
};

/**
 * Build the transaction.
 *
 * @returns {Array} The transaction data.
 */
TxBuilder.prototype.build = function() {
    return this._txes;
};

/**
 * Convert the argument to a keyword.
 *
 * @param s The string or keyword.
 * @returns {*} The keyword.
 */
function keyword(s) {
    if (transit.isKeyword(s)) {
        return s;
    } else if (s[0] === ':') {
        return transit.keyword(s.slice(1));
    } else {
        return transit.keyword(s);
    }
}

/**
 * Convert the argument to a symbol.
 *
 * @param s A string, or a symbol.
 * @returns {*} The symbol.
 */
function symbol(s) {
    if (transit.isSymbol(s)) {
        return s;
    } else {
        return transit.symbol(s);
    }
}

/**
 * Convert the argument string to a {@link shared.UUID}.
 *
 * @param s The string.
 * @returns {UUID} The UUID.
 */
function uuid(s) {
    if (s instanceof shared.UUID) {
        return s;
    } else {
        return new shared.UUID(s);
    }
}

/**
 * Convert the argument to a {@link shared.BigInt}.
 *
 * @param s The input.
 * @returns {shared.BigInt} The big int.
 */
function bigInt(s) {
    if (s instanceof shared.BigInt) {
        return s;
    } else {
        return new shared.BigInt(s);
    }
}

/**
 * Convert the argument to a {@link shared.BigDec}.
 *
 * @param s The input.
 * @returns {BigDec} The big decimal.
 */
function bigDec(s) {
    if (s instanceof shared.BigDec) {
        return s;
    } else {
        return new shared.BigDec(s);
    }
}

exports.TxBuilder = TxBuilder;
exports.keyword = keyword;
exports.symbol = symbol;
exports.uuid = uuid;
exports.bigInt = bigInt;
exports.bigDec = bigDec;
exports.convertE = convertE;
exports.convertV = convertV;