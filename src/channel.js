'use strict';

const MAX_PENDING = 1024;

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

Channel.prototype.isClosed = function() {
    return this.closed;
}

Channel.prototype.close = function() {
    this.closed = true;
    this.producers.forEach(p => {
        p[2](false);
    });
};

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
        callback();
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

Channel.prototype.put = function(val) {
    return doPut(this, val, null);
};

Channel.prototype.error = function(err) {
    return doPut(this, null, err);
};

exports.Channel = Channel;