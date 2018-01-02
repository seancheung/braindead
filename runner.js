const Promise = require('bluebird');

module.exports = class Runner {

    constructor(steps, options) {
        this.forever = false;
        this.client = null;
        this.$session = {};
        this.$options = options || {};
        this.funcs = steps.map(step => {
            if (this.forever) {
                throw new Error('redundant steps after a forever step');
            }
            if (!step || typeof step !== 'object') {
                throw new Error('step must be an object');
            }
            const [key] = Object.keys(step);
            if (!key) {
                throw new Error('empty step');
            }
            const value = step[key];
            if (key === 'connect') {
                if (!value) {
                    throw new Error('connect must be a string or an object');
                }
                const Client = require('./client');

                return () => {
                    let uri, host, port, ssl;
                    const options = this.replace(value);
                    if (typeof options === 'string') {
                        uri = options;
                    } else if (options.host && options.port) {
                        host = options.host;
                        port = options.port;
                        ssl = options.ssl;
                    } else {
                        throw new Error('missing host/port in connect');
                    }
                    this.client = new Client({
                        uri,
                        host,
                        port,
                        ssl,
                        timeout: options.timeout,
                        errorHandler: this.onError.bind(this),
                        messageHandler: this.onMessage.bind(this),
                        kickHandler: this.onKick.bind(this),
                        disconnectHandler: this.onDisconnect.bind(this)
                    });
                    this.debug.info(`connect: ${this.client.uri}`);

                    return this.client.connect();
                };
            }
            if (key === 'disconnect') {
                return () => {
                    this.debug.info(`disconnect: ${this.client.uri}`);

                    return this.client.disconnect();
                };
            }
            if (key === 'sleep') {
                if (typeof value !== 'number') {
                    throw new Error('sleep must be a number');
                }

                return () =>
                    new Promise(resolve => {
                        this.debug.info(`sleep: ${value}`);
                        setTimeout(resolve, value);
                    });
            }
            if (key === 'echo') {
                if (value === undefined) {
                    throw new Error('echo must be defined');
                }

                return () => {
                    const output = this.replace(value);
                    this.debug.verbose(JSON.stringify(output));
                };
            }
            if (key === 'emit') {
                if (!value) {
                    throw new Error('emit must be a string or an object');
                }
                if (typeof value === 'string') {
                    return () => {
                        this.debug.info(`emit: ${value}`);

                        return this.client
                            .request(value)
                            .then(res =>
                                this.debug.verbose(JSON.stringify(res))
                            );
                    };
                }
                const route = value.route;
                if (typeof route !== 'string') {
                    throw new Error('missing route in emit');
                }
                const data = value.data;
                const expect = value.expect;
                const session = value.session;
                if (expect && typeof expect !== 'object') {
                    throw new Error('done must be an object');
                }
                if (session && typeof session !== 'object') {
                    throw new Error('session must be an object');
                }
                const repeat = value.repeat;
                if (repeat && typeof repeat !== 'object') {
                    throw new Error('repeat must be an object');
                }
                const count = repeat && repeat.count;
                const sleep = repeat && repeat.sleep;
                if (sleep && typeof sleep !== 'number') {
                    throw new Error('sleep must be a number');
                }
                if (count && typeof count !== 'number') {
                    throw new Error('count must be a number');
                }
                this.forever = repeat && !count;

                return () => {
                    const msg = this.replace(data);
                    if (msg === undefined) {
                        this.debug.info(`emit: ${route}`);
                    } else {
                        this.debug.info(
                            `emit: ${route} ${JSON.stringify(msg)}`
                        );
                    }
                    const emit = () =>
                        this.client.request(route, msg).then(res => {
                            this.debug.verbose(JSON.stringify(res));
                            if (expect) {
                                this.expect(res, expect);
                            }
                            if (session) {
                                this.update(session, res);
                            }
                        });
                    if (!repeat) {
                        return emit();
                    }
                    if (this.forever) {
                        const run = () => {
                            emit().then(() => {
                                if (!sleep) {
                                    run();
                                } else {
                                    this.debug.info(`sleep: ${sleep}`);
                                    setTimeout(() => run(), sleep);
                                }
                            });
                        };
                        this.debug.info('repeat: forever');

                        return run();
                    }

                    let cycle = 0;

                    return new Promise((resolve, reject) => {
                        const run = () => {
                            if (cycle++ < count) {
                                this.debug.info(`repeat: ${cycle}/${count}`);
                                emit()
                                    .then(() => {
                                        if (!sleep || cycle >= count) {
                                            run();
                                        } else {
                                            this.debug.info(`sleep: ${sleep}`);
                                            setTimeout(() => run(), sleep);
                                        }
                                    })
                                    .catch(reject);
                            } else {
                                resolve();
                            }
                        };
                        run();
                    });
                };
            }
            throw new Error(`unknown step ${key}`);
        });
    }

    update(session, data) {
        Object.keys(session).forEach(key => {
            if (typeof session[key] !== 'string') {
                throw new Error('session properties must be strings');
            }
            this.$session[key] = session[key]
                .split('.')
                .reduce((v, c) => v[c], data);
        });
    }

    replace(data) {
        if (typeof data === 'string') {
            if (data.startsWith('$session.')) {
                data = data
                    .split('.')
                    .slice(1)
                    .reduce((v, c) => v[c], this.$session);
            } else if (data.startsWith('$opts.')) {
                data = data
                    .split('.')
                    .slice(1)
                    .reduce((v, c) => v[c], this.$options);
            } else if (data.startsWith('$args.')) {
                data = data
                    .split('.')
                    .slice(1)
                    .reduce((v, c) => v[c], this.$args);
            } else if (data.startsWith('$env.')) {
                const [, key] = data.split(/\s+(.+)/, 2);
                data = process.env[key];
            }
        } else if (typeof data === 'object') {
            data = JSON.parse(JSON.stringify(data));
            Object.keys(data).forEach(key => {
                data[key] = this.replace(data[key]);
            });
        }

        return data;
    }

    run(debug, args) {
        this.debug = {
            verbose: (debug && debug.verbose) || (() => {}),
            info: (debug && debug.info) || (() => {}),
            warn: (debug && debug.warn) || (() => {}),
            error: (debug && debug.error) || (() => {}),
            end: (debug && debug.end) || (() => {})
        };
        this.$args = args || {};

        return Promise.mapSeries(this.funcs, func =>
            Promise.try(() => func(this))
        ).then(() => {
            if (!this.forever) {
                this.debug.end();
            }

            return this;
        });
    }

    onError(err) {
        this.debug.error(err);
    }

    onMessage(route, msg) {
        this.debug.verbose('event:', route, msg);
    }

    onKick(msg) {
        this.debug.warn('kicked', msg && JSON.stringify(msg));
    }

    onDisconnect(code, reason) {
        if (code !== 1000) {
            this.debug.error(
                new Error(`disconnected: code: ${code}, reason: ${reason}`)
            );
        } else {
            this.debug.info('disconnected');
        }
    }

    expect(source, test) {
        if (!source && !test) {
            return;
        }
        if (
            typeof test === 'string' &&
            /^\/.+\/$/.test(test) &&
            typeof source !== 'object'
        ) {
            if (
                new RegExp(test.slice(1, test.length - 1)).test(String(source))
            ) {
                return;
            }
        }
        if (typeof source !== typeof test) {
            throw new Error(
                `${JSON.stringify(source)} !== ${JSON.stringify(test)}`
            );
        }
        if (source === test) {
            return;
        }
        if (typeof source !== 'object') {
            throw new Error(
                `${JSON.stringify(source)} !== ${JSON.stringify(test)}`
            );
        }
        Object.keys(test).forEach(key => this.expect(source[key], test[key]));
    }

};
