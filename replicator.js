const LEVEL = {
    VERBOSE: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    debugger: {
        verbose: require('debug')('replicator:verbose'),
        info: require('debug')('replicator:info'),
        warn: require('debug')('replicator:warn'),
        error: require('debug')('replicator:error')
    },
    get(level) {
        if (!level) {
            return LEVEL.INFO;
        }
        switch (level) {
        case 0:
        case '0':
        case 'v':
        case 'verbose':
            return LEVEL.VERBOSE;
        case 1:
        case '1':
        case 'i':
        case 'info':
            return LEVEL.INFO;
        case 2:
        case '2':
        case 'w':
        case 'warn':
            return LEVEL.WARN;
        case 3:
        case '3':
        case 'e':
        case 'error':
            return LEVEL.WARN;
        default:
            return LEVEL.INFO;
        }
    }
};

module.exports = class Replicator {

    /**
     * Creates an instance of Replicator.
     * @param {Array<(id: Number, replicator: Replicator)=>void>} tasks
     * @param {{interval?: number, concurrency?: number, level?: 'verbose'|'info'|'warn'|'error', log?: String}} options
     */
    constructor(tasks, options) {
        this.tasks = tasks;
        this.options = options || {};
        this.instances = new Set();
        this.interval = this.options.interval || 250;
        this.maxConcurrency = this.options.concurrency || 100;
        this.level = LEVEL.get(this.options.level);
        this.timer = null;
        this.index = 0;

        if (this.options.log) {
            let file = this.options.log;
            const path = require('path');
            if (!path.isAbsolute(file)) {
                file = path.resolve(process.cwd(), file);
            }
            const fs = require('fs');
            const stream = fs.createWriteStream(file, {
                flags: 'w',
                encoding: 'utf8'
            });
            const util = require('util');
            const moment = require('moment');
            this.logger = (...args) => {
                stream.write(
                    util.format(moment().format('YYYY/M/D-HH:mm:ss'), ...args) +
                        '\n',
                    'utf8'
                );
            };
            process.on('uncaughtException', function(err) {
                stream.write(
                    util.format(
                        moment().format('YYYY/M/D-HH:mm:ss'),
                        'fatal',
                        util.inspect(err && err.stack ? err.stack : err)
                    ) + '\n',
                    'utf8',
                    () => process.exit(1)
                );
            });
        } else {
            this.logger = () => {};
        }
    }

    get random() {
        return this.tasks[Math.floor(Math.random() * this.tasks.length)];
    }

    get concurrency() {
        return this.instances.size;
    }

    get debugger() {
        return LEVEL.debugger;
    }

    start() {
        if (!this.timer) {
            this.timer = setInterval(this.tick.bind(this), this.interval);
            this.tick();
        }
    }

    tick() {
        if (this.instances.size < this.maxConcurrency) {
            this.populate();
        } else {
            this.cancel();
        }
    }

    populate() {
        this.instances.add(++this.index);
        this.random(this.index, this);
    }

    dispose(index) {
        this.instances.delete(index);
        if (this.instances.size === 0) {
            process.exit(0);
        }
    }

    cancel() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    verbose(...args) {
        if (this.level <= LEVEL.VERBOSE) {
            LEVEL.debugger.verbose(...args);
            this.logger('[verbose]', ...args);
        }
    }
    info(...args) {
        if (this.level <= LEVEL.INFO) {
            LEVEL.debugger.info(...args);
            this.logger('[info]', ...args);
        }
    }
    warn(...args) {
        if (this.level <= LEVEL.WARN) {
            LEVEL.debugger.warn(...args);
            this.logger('[warn]', ...args);
        }
    }
    error(...args) {
        if (this.level <= LEVEL.ERROR) {
            LEVEL.debugger.error(...args);
            this.logger('[error]', ...args);
        }
    }

};
