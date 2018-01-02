const Promise = require('bluebird');
const ws = require('ws');
const { Package, strencode, Message, strdecode } = require('pomelo-protocol');

module.exports = class Client {

    /**
     * Creates an instance of Client.
     * @param {{uri?: string, host?: string, port?: number, ssl?: boolean, timeout?: number, errorHandler: (err: Error)=>void, disconnectHandler?: (code?: Number, reason: string)=>void, messageHandler?: (route: string, msg: any)=>void, kickHandler?: (msg: any)=>void}} options
     */
    constructor(options) {
        if (!options) {
            options = {};
        }
        this.socket = null;
        if (options.uri) {
            this.uri = options.uri;
        } else {
            this.host = options.host || 'localhost';
            this.port = options.port || 3010;
            this.protocol = options.ssl ? 'wss' : 'ws';
            this.uri = `${this.protocol}://${this.host}:${this.port}`;
        }
        this.timeout = options.timeout || 3000;
        this.subscribers = new Map();
        this.index = 1;
        this.useDict = false;
        this.c2r = new Map();
        this.r2c = new Map();
        this.useProtos = false;
        this.protos = {};
        this.ready = false;
        this.heartbeatTimer = null;
        this.heartbeatInterval = null;
        this.heartbeatTimeoutTimer = null;
        this.errorHandler = options.errorHandler;
        this.messageHandler = options.messageHandler;
        this.disconnectHandler = options.disconnectHandler;
        this.kickHandler = options.kickHandler;
        this.handshakeHandler = null;
    }

    /**
     * Connect to remote
     *
     * @returns {Promise<void>}
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                this.socket = new ws(this.uri, { rejectUnauthorized: false });
                this.socket.binaryType = 'arraybuffer';
                this.socket.onerror = err => reject(err);
                const timeout = setTimeout(
                    () => reject(new Error(`connection ${this.uri} timeout`)),
                    this.timeout
                );
                this.socket.onopen = () => {
                    try {
                        this.socket.send(
                            Package.encode(
                                Package.TYPE_HANDSHAKE,
                                strencode(
                                    JSON.stringify({
                                        sys: { protoVersion: 0 },
                                        user: {}
                                    })
                                )
                            )
                        );
                        this.handshakeHandler = () => {
                            this.socket.onerror = err => {
                                if (this.errorHandler) {
                                    this.errorHandler(err);
                                }
                            };
                            clearTimeout(timeout);
                            resolve();
                        };
                    } catch (err) {
                        clearTimeout(timeout);
                        reject(err);
                    }
                };
                this.socket.onmessage = ({ data }) => {
                    data = Package.decode(data);
                    if (Array.isArray(data)) {
                        data.forEach(d => this.dispatch(d.type, d.body));
                    } else {
                        this.dispatch(data.type, data.body);
                    }
                };
                this.socket.onclose = ({ code, reason }) => {
                    if (this.disconnectHandler) {
                        this.disconnectHandler(code, reason);
                    }
                };
            }
        });
    }

    /**
     * Disconnect from remote
     * @param {number} [code]
     */
    disconnect(code) {
        if (this.socket) {
            this.socket.close(code || 1000);
            this.socket = null;
            if (this.heartbeatTimer) {
                clearTimeout(this.heartbeatTimer);
                delete this.heartbeatTimer;
            }
            if (this.heartbeatTimeoutTimer) {
                clearTimeout(this.heartbeatTimeoutTimer);
                delete this.heartbeatTimeoutTimer;
            }
        }
    }

    /**
     * Pack data to packet
     *
     * @param {string} route
     * @param {any} [msg]
     * @param {number} [id]
     * @returns
     */
    pack(route, msg, id) {
        const compress = this.useDict && this.r2c.has(route);
        if (compress) {
            route = this.r2c.get(route);
        }
        if (!msg) {
            msg = {};
        }
        if (this.useProtos && this.protos.client[route]) {
            //TODO: protobuf
            msg = this.protobuf.encode(route, msg);
        } else {
            msg = strencode(JSON.stringify(msg));
        }
        msg = Message.encode(
            id,
            id ? Message.TYPE_REQUEST : Message.TYPE_NOTIFY,
            compress,
            route,
            msg
        );

        return Package.encode(Package.TYPE_DATA, msg);
    }

    /**
     * Notify
     *
     * @param {string} route
     * @param {any} [msg]
     * @returns {Promise<void>}
     */
    notify(route, msg) {
        return new Promise((resolve, reject) => {
            try {
                const packet = this.pack(route, msg);
                this.socket.send(packet);
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Make a request
     *
     * @param {string} route
     * @param {any} [msg]
     * @returns {Promise<any>}
     */
    request(route, msg) {
        return new Promise((resolve, reject) => {
            const id = this.index++;
            const timeout = setTimeout(
                () => reject(new Error(`${route} timeout`)),
                this.timeout
            );
            this.subscribers.set(id, res => {
                clearTimeout(timeout);
                resolve(res);
            });
            try {
                const packet = this.pack(route, msg, id);
                this.socket.send(packet);
            } catch (err) {
                clearTimeout(timeout);
                this.subscribers.delete(id);
                reject(err);
            }
        });
    }

    dispatch(type, data) {
        switch (type) {
        case Package.TYPE_HANDSHAKE:
            {
                const msg = JSON.parse(strdecode(data));
                if (msg.code !== 200) {
                    throw new Error('handshake failed');
                }
                if (msg.sys.heartbeat) {
                    this.heartbeatInterval = msg.sys.heartbeat * 1000;
                    this.heartbeatTimeout = this.heartbeatInterval * 2;
                }
                if (msg.sys.dict) {
                    this.useDict = true;
                    for (const route in msg.sys.dict) {
                        this.c2r.set(msg.sys.dict[route], route);
                        this.r2c.set(route, msg.sys.dict[route]);
                    }
                }
                if (msg.sys.protos) {
                    this.useProtos = true;
                    //TODO: protobuf
                    this.protobuf = { encode() {}, init() {}, decode() {} };
                    this.protos.version = msg.sys.protos.protoVersion || 0;
                    this.protos.server = msg.sys.protos.server;
                    this.protos.client = msg.sys.protos.client;
                    this.protobuf.init({
                        encoderProtos: this.protos.client,
                        decoderProtos: this.protos.server
                    });
                }

                if (this.handshakeHandler) {
                    this.handshakeHandler(msg);
                }

                try {
                    this.socket.send(
                        Package.encode(Package.TYPE_HANDSHAKE_ACK)
                    );
                } catch (err) {
                    if (this.errorHandler) {
                        this.errorHandler(err);
                    }
                }
                this.ready = true;
            }
            break;
        case Package.TYPE_HEARTBEAT:
            {
                if (this.heartbeatTimeoutTimer) {
                    clearTimeout(this.heartbeatTimeoutTimer);
                    this.heartbeatTimeoutTimer = null;
                }

                if (!this.heartbeatTimer) {
                    this.heartbeatTimer = setTimeout(() => {
                        this.heartbeatTimer = null;
                        try {
                            this.socket.send(
                                Package.encode(Package.TYPE_HEARTBEAT)
                            );
                        } catch (err) {
                            if (this.errorHandler) {
                                this.errorHandler(err);
                            }
                        }
                        this.heartbeatTimeoutTimer = setTimeout(() => {
                            if (this.errorHandler) {
                                this.errorHandler(
                                    new Error('heartbeat timeout')
                                );
                            }
                            // this.disconnect(1001);
                        }, this.heartbeatTimeout + 500);
                    }, this.heartbeatInterval);
                }
            }
            break;
        case Package.TYPE_DATA:
            {
                const msg = Message.decode(data);
                if (msg.compressRoute) {
                    if (!this.c2r.has(msg.route)) {
                        throw new Error(
                            `route compress nout found ${msg.route}`
                        );
                    }
                    msg.route = this.c2r.get(msg.route);
                }

                let body;
                if (this.useProtos && this.protos.server[msg.route]) {
                    body = this.protobuf.decode(msg.route, msg.body);
                } else {
                    body = JSON.parse(strdecode(msg.body));
                }

                if (msg.id && this.subscribers.has(msg.id)) {
                    const subscriber = this.subscribers.get(msg.id);
                    this.subscribers.delete(msg.id);
                    subscriber(body);
                } else if (this.messageHandler) {
                    this.messageHandler(msg.route, body);
                }
            }
            break;
        case Package.TYPE_KICK:
            {
                if (this.kickHandler) {
                    this.kickHandler(JSON.parse(strdecode(data)));
                }
            }
            break;
        }
    }

};
