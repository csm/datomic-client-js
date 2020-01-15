'use strict';

const MAX_PENDING = 1024;

/**
 * As asynchronous channel, possibly buffered.
 *
 * Takes either a capacity argument (a number) or no arguments.
 * The channel will have the given capacity if specified; otherwise returns
 * an unbuffered channel.
 *
 * @constructor Channel
 */
function Channel() {
    switch (arguments.length) {
        case 0:
            this.capacity = 0;
            break;
        case 1:
            this.capacity = arguments[0];
            break;
    }
    this.producers = [];
    this.consumers = [];
    this.waitingProducers = [];
    this.closed = false;
}

/**
 * Tell if this channel is closed.
 *
 * @returns {boolean} True if closed.
 */
Channel.prototype.isClosed = function() {
    return this.closed;
};

/**
 * Closes this channel. This channel will not accept any more
 * puts, and takes will only consume puts already enqueued.
 */
Channel.prototype.close = function() {
    this.closed = true;
    this.producers.forEach(p => {
        p[2](false);
    });
};

/**
 * Take a value from the channel. Returns a promise that will
 * yield the value read once a corresponding put call is made.
 *
 * Returns a promise that yields null if the channel is closed.
 *
 * @returns {Promise<never>|Promise<unknown>}
 */
Channel.prototype.take = function() {
    if (this.producers.length > 0) {
        let producer = this.producers.shift();
        let value = producer[0];
        let error = producer[1];
        let _this = this;
        let nextProducer = _this.waitingProducers.shift();
        if (nextProducer != null && this.producers.length < this.capacity) {
            this.producers.push(nextProducer.slice(0, 2));
            nextProducer[2](true)
        }
        if (error != null) {
            return Promise.reject(error);
        } else {
            return Promise.resolve(value);
        }
    } else if (this.waitingProducers.length > 0) {
        let producer = this.waitingProducers.shift();
        let value = producer[0];
        let error = producer[1];
        let callback = producer[2];
        callback(true);
        if (error != null) {
            return Promise.reject(error);
        } else {
            return Promise.resolve(value);
        }
    } else if (this.closed) {
        return Promise.resolve(null);
    } else if (this.consumers.length < MAX_PENDING) {
        let _this = this;
        return new Promise((resolve, reject) => {
            _this.consumers.push([resolve, reject]);
        });
    } else {
        throw new Error('too many pending takes');
    }
};

function doPut(chan, value, error) {
    if (chan.consumers.length > 0) {
        let consumer = chan.consumers.shift();
        if (error != null) {
            consumer[1](error);
        } else {
            consumer[0](value);
        }
        return Promise.resolve(true);
    } else if (chan.closed) {
        return Promise.resolve(false);
    } else if (chan.producers.length < chan.capacity) {
        chan.producers.push([value, error, null]);
        return Promise.resolve(true);
    } else if (chan.waitingProducers.length < MAX_PENDING) {
        return new Promise(resolve => {
            if (error != null) {
                chan.waitingProducers.push([null, error, resolve]);
            } else {
                chan.waitingProducers.push([value, null, resolve]);
            }
        });
    } else {
        throw new Error('too many pending puts');
    }
}

/**
 * Put a value on the channel. Returns a promise that will yield
 * a boolean value when the put has completed. The promise will
 * always yield true unless the channel is closed.
 *
 * @param val The value to put on the channel.
 * @returns The promise.
 */
Channel.prototype.put = function(val) {
    return doPut(this, val, null);
};

/**
 * Put an error on the channel. Returns a promise that will yield
 * a boolean value when the put has completed. The promise will
 * always yield true unless the channel is closed.
 *
 * @param err The error to put on the channel.
 * @returns The promise.
 */
Channel.prototype.error = function(err) {
    return doPut(this, null, err);
};

exports.Channel = Channel;