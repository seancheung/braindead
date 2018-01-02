/* eslint no-console: off */
const program = require('commander');
const Promise = require('bluebird');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

program
    .version('0.1.0')
    .description('run client shell or replicator')
    .arguments('[files]')
    .option('-H, --host <host>', 'client host', 'localhost')
    .option('-P, --port <port>', 'client port')
    .option('-S, --ssl', 'enable SSL')
    .option('-U, --uri <address>', 'uri')
    .option('-t, --timeout <miliseconds>', 'request timeout')
    .option('-r, --replicate', 'replicate clients')
    .option('-i, --interval <miliseconds>', 'replicator intervel')
    .option('-c, --concurrency <count>', 'replicator concurrent count')
    .option('-l, --level <verbose|info|warn|error>', 'replicator log level')
    .option('-p, --prefix <prefix>', 'replicator instance id prefix')
    .option('-o, --log <path>', 'replicator log file path')
    .parse(process.argv);

function run() {
    if (program.replicate && program.args && program.args.length > 0) {
        return replicate();
    }

    if (program.args && program.args.length > 0) {
        return Promise.map(program.args, file => {
            if (!path.isAbsolute(file)) {
                file = path.resolve(process.cwd(), file);
            }
            if (!/\.ya?ml$/.test(file)) {
                throw new Error('only yaml format is supported');
            }
            if (!fs.existsSync(file)) {
                throw new Error('file does not exist');
            }
            const yaml = require('js-yaml').safeLoad(
                fs.readFileSync(file, 'utf8')
            );
            if (Array.isArray(yaml)) {
                const Runner = require('./runner');

                return new Runner(yaml);
            }

            throw new Error('invalid yaml');
        })
            .mapSeries(
                runner =>
                    new Promise((resolve, reject) => {
                        runner.run({
                            verbose: (...args) => console.log(...args),
                            info: (...args) =>
                                console.log(chalk.green(...args)),
                            warn: (...args) =>
                                console.warn(chalk.yellow(...args)),
                            error: err => {
                                reject(err);
                            },
                            end: () => resolve()
                        });
                    })
            )
            .then(() => {
                process.exit(0);
            })
            .catch(err => {
                console.error(chalk.red(err));
                process.exit(1);
            });
    }

    if ((program.host && program.port) || program.uri) {
        const Client = require('./client');
        const client = new Client({
            uri: program.uri,
            host: program.host,
            port: program.port,
            ssl: program.ssl,
            timeout: program.timeout,
            errorHandler: err => {
                console.error(
                    chalk.red(
                        JSON.stringify(err, Object.getOwnPropertyNames(err))
                    )
                );
            },
            disconnectHandler: (code, reason) => {
                if (code !== 1000) {
                    const args = [chalk.red('disconnected'), chalk.red(code)];
                    if (reason) {
                        args.push(JSON.stringify(reason));
                    }
                    console.error(...args);
                }
                process.exit(0);
            },
            messageHandler: (route, msg) => {
                console.log(chalk.green(route), JSON.stringify(msg));
            },
            kickHandler: msg => {
                console.warn(chalk.yellow('kicked'), JSON.stringify(msg));
            }
        });

        const domian = `${client.protocol}://${client.host}:${client.port}`;

        const open = () => client.connect();
        const close = () => client.disconnect();
        const info = () => {
            console.log(
                `${chalk.green('<route> [json message]')} send message`
            );
        };

        const exec = input => {
            const [route, body] = input.split(/\s+(.+)/, 2);

            if (!route) {
                return Promise.resolve();
            }
            let json;
            if (body) {
                try {
                    json = JSON.parse(body);
                } catch (err) {
                    return Promise.reject(err);
                }
            }

            return client.request(route, json);
        };

        return interact(
            {
                open,
                close,
                exec
            },
            domian,
            arg => console.log(arg),
            info
        );
    }
}

function replicate() {
    const Runner = require('./runner');
    const runners = program.args.map(file => {
        if (!file) {
            throw new Error('yaml file must be specified');
        }
        if (!path.isAbsolute(file)) {
            file = path.resolve(process.cwd(), file);
        }
        if (!/\.ya?ml$/.test(file)) {
            throw new Error('only yaml format is supported');
        }
        if (!fs.existsSync(file)) {
            throw new Error('file does not exist');
        }
        const yaml = require('js-yaml').safeLoad(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(yaml)) {
            throw new Error('invalid yaml format');
        }

        return new Runner(yaml);
    });
    const Replicator = require('./replicator');
    const prefix = program.prefix || `_${Date.now()}_robot_`;
    const replicator = new Replicator(
        runners.map(runner => (id, rep) => {
            const name = `${prefix}${id}`;
            const domain = `<${name}>`;
            rep.info(domain, 'started');
            rep.warn('ccu:', `${rep.concurrency}/${rep.maxConcurrency}`);
            runner
                .run(
                    {
                        verbose: (...args) => rep.verbose(domain, ...args),
                        info: (...args) => rep.info(domain, ...args),
                        warn: (...args) => rep.warn(domain, ...args),
                        error: err => {
                            rep.error(domain, err.message);
                            rep.dispose(id);
                        },
                        end: () => {
                            rep.info(domain, 'complete');
                            rep.warn(
                                'ccu:',
                                `${rep.concurrency}/${rep.maxConcurrency}`
                            );
                            rep.dispose(id);
                        }
                    },
                    {
                        id,
                        name,
                        domain
                    }
                )
                .catch(err => {
                    rep.error(domain, err.message);
                    process.exit(1);
                });
        }),
        program.opts()
    );
    replicator.debugger.verbose = (...args) => console.log(...args);
    replicator.debugger.info = (...args) => console.info(chalk.green(...args));
    replicator.debugger.warn = (...args) => console.warn(chalk.yellow(...args));
    replicator.debugger.error = (...args) => console.error(chalk.red(...args));
    replicator.start();
}

function interact(client, domain, dump, info) {
    return client
        .open()
        .then(() => {
            const help = () => {
                console.log(`${chalk.green('/h, help, ?')}\t show help`);
                console.log(
                    `${chalk.green('/q, quit, exit, close')}\t close connection`
                );

                return Promise.try(() => {
                    if (info) {
                        return info();
                    }
                });
            };

            const readline = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });
            const query = input => {
                return client.exec(input).then(result => {
                    if (result !== undefined) {
                        dump(result);
                    }
                });
            };

            const prompt = () => {
                readline.question(`${domain}>`, input => {
                    switch (input) {
                    case 'help':
                    case '?':
                    case '/h':
                        help().then(() => prompt());
                        break;
                    case 'exit':
                    case 'quit':
                    case 'close':
                    case '/q':
                        readline.close();
                        client.close();
                        break;
                    default:
                        query(input)
                            .then(prompt)
                            .catch(err => {
                                danger(err);
                                prompt();
                            });
                        break;
                    }
                });
            };

            help().then(() => prompt());
        })
        .catch(err => {
            danger(err);
            process.exit(1);
        });
}

function danger(err) {
    console.error(chalk.red(require('util').inspect(err)));
}

run();
