'use strict';

let transit = require('transit-js');

/**
 * A builder for datomic queries. This is meant to help build datomic
 * queries in a more fluent manner. Without this, you would need to
 * specify transit.Keyword and transit.Symbol values in your query,
 * which is verbose and cumbersome.
 *
 * @deprecated Use EDN template strings instead.
 *
 * @constructor QueryBuilder
 */
function QueryBuilder() {
    this._find = null;
    this._with = null;
    this._in = null;
    this._where = null;
    this._keys = null;
    this._syms = null;
    this._strs = null;
}

/**
 * Add a :find expression to the query.
 *
 * If there are already find elements added, these are added to the end.
 *
 * @param args Elements to find. Can either be strings (to find attributes)
 *   or composite query elements (pull, count, etc).
 * @returns This builder.
 */
QueryBuilder.prototype.find = function(...args) {
    let find = [];
    for (let i = 0; i < args.length; i++) {
        let arg = args[i];
        if (typeof arg === 'string') {
            find.push(transit.symbol(arg));
        } else {
            find.push(arg);
        }
    }
    this._find = (this._find || []).concat(find);
    return this;
};

/**
 * Add an :in expression to the query.
 *
 * @param args The input sources. Can be strings, arrays of strings,
 *   or an array of a string and '...'.
 * @returns This builder.
 */
QueryBuilder.prototype.in = function(...args) {
    let convertInput = function(input) {
        if (typeof input === 'string') {
            return transit.symbol(input);
        } else if (Array.isArray(input)) {
            return input.map(convertInput);
        } else {
            return input;
        }
    };
    this._in = (this._in || []).concat(args.map(convertInput));
    return this;
};

/**
 * Add a :with expression to the query.
 *
 * @param args Symbol strings that should be added to the :with clause.
 * @returns {QueryBuilder} This instance.
 */
QueryBuilder.prototype.with = function(...args) {
    this._with = (this._with || []).concat(args.map(transit.symbol));
    return this;
};

/**
 * Add a :keys expression to the query.
 *
 * @param args Symbol strings to add to the :keys clause.
 * @returns {QueryBuilder} This instance.
 */
QueryBuilder.prototype.keys = function(...args) {
    this._keys = (this._keys || []).concat(args.map(transit.symbol));
    return this;
};

/**
 * Add a :syms expression to the query.
 *
 * @param args Symbol strings to add to the :syms clause.
 * @returns {QueryBuilder} This instance.
 */
QueryBuilder.prototype.syms = function(...args) {
    this._syms = (this._syms || []).concat(args.map(transit.symbol));
    return this;
};

/**
 * Add a :strs expression to the query.
 *
 * @param args Symbol strings to add to the :strs clause.
 * @returns {QueryBuilder} This instance.
 */
QueryBuilder.prototype.strs = function(...args) {
    this._strs = (this._strs || []).concat(args.map(transit.symbol));
    return this;
};

/**
 * Adds :where clauses to the query.
 *
 * Each argument may be one of the following:
 *
 * <ul>
 *     <li><pre>[e, attr]</pre></li>
 *     <li><pre>[e, attr, (symbol|value)]</pre></li>
 *     <li><pre>[e, attr, (symbol|value), t]</pre></li>
 *     <li><pre>[e, attr, (symbol|value), t, added]</pre></li>
 *     <li><pre>[predicate-expression]</pre></li>
 *     <li>TODO there should be more.</li>
 * </ul>
 *
 * @param args Where clauses to add.
 * @returns {QueryBuilder} This instance.
 */
QueryBuilder.prototype.where = function(...args) {
    let convertWhere = function (where) {
        if (Array.isArray(where)) {
            if (typeof where[0] === 'string' && typeof where[1] === 'string') {
                return [transit.symbol(where[0]), transit.keyword(where[1])].concat(where.slice(2).map((e) => {
                    if (typeof e == 'string') {
                        return transit.symbol(e);
                    } else {
                        return e;
                    }
                }));
            } else {
                throw new Error('todo');
            }
        } else {
            throw new Error('each where expression should be an array');
        }
    };
    this._where = (this._where || []).concat(args.map(convertWhere));
    return this;
};

/**
 * Build the query.
 *
 * @returns {*} A value that can be sent via {@link Connection.q}.
 */
QueryBuilder.prototype.build = function () {
    let res = [];
    if (this._find != null) {
        res.push(transit.keyword('find'));
        res = res.concat(this._find);
    } else {
        throw new Error('no find expression');
    }
    if (this._in != null) {
        res.push(transit.keyword('in'));
        res = res.concat(this._in);
    }
    if (this._with != null) {
        res.push(transit.keyword('with'));
        res = res.concat(this._with);
    }
    if (this._where != null) {
        res.push(transit.keyword('where'));
        res = res.concat(this._where);
    } else {
        throw new Error('no where expressions');
    }
    if (this._keys != null) {
        res.push(transit.keyword('keys'));
        res = res.concat(this._keys);
    }
    if (this._syms != null) {
        res.push(transit.keyword('syms'));
        res = res.concat(this._syms);
    }
    if (this._strs != null) {
        res.push(transit.keyword('strs'));
        res = res.concat(this._strs);
    }
    return res;
};

function convertAttributeSpec(spec) {
    if (spec === '*') {
        return transit.symbol('*');
    } else if (typeof spec === 'string') {
        return transit.keyword(spec);
    } else if (Array.isArray(spec)) {
        if (spec[0] === 'limit') { // limit expression
            return transit.list([transit.symbol('limit'), transit.keyword(spec[1]), spec[2]]);
        } else if (spec[0] === 'default') { // default expression
            return transit.list([transit.symbol('default'), transit.keyword(spec[1]), spec[2]]);
        } else { // attr-with-options
            let expr = [transit.keyword(spec[0])];
            for (let i = 1; i + 1 < spec.length; i += 2) {
                expr.push(transit.keyword(spec[i]));
                expr.push(spec[i + 1]);
            }
            return expr;
        }
    } else if (typeof spec === 'object') {
        let res = transit.map();
        for (let k in spec) {
            if (spec.hasOwnProperty(k)) {
                let v = spec[k];
                if (typeof v === 'number') {
                    res.set(convertAttributeSpec(k), v);
                } else if (v === '...') {
                    res.set(convertAttributeSpec(k), transit.symbol('...'));
                } else {
                    res.set(convertAttributeSpec(k), convertSelector(v));
                }
            }
        }
        return res;
    }
}

function convertSelector(selector) {
    if (Array.isArray(selector)) {
        return selector.map(convertAttributeSpec);
    } else if (typeof selector === 'object') {
        throw new Error('pull selector must be an array');
    }
}

/**
 * Build a pull expression for use in a datomic query. The result
 * is typically passed to {@link #find}.
 *
 * @param eid A string describing the symbol name to use in the pull.
 * @param selector A selector that conforms to the datomic selector syntax,
 *   that is, nested arrays and objects, with the refinement that keywords
 *   may be represented just as strings.
 */
function pull(eid, selector) {
    let res = [];
    res.push(transit.symbol('pull'));
    res.push(transit.symbol('eid'));
    res.push(convertSelector(selector));
    return transit.list(res);
};

/**
 * Return a count expression, for use in {@link #find).
 *
 * @param symbol The symbol name being queried.
 * @returns The constructed count expression.
 */
function count(symbol) {
    return transit.list([transit.symbol('count'), transit.symbol(symbol)]);
}

exports.QueryBuilder = QueryBuilder;
exports.convertSelector = convertSelector;