Braindead
---
Websocket cli client and replicator

## Installation

```bash
npm i -g braindead
```

## Usage

```bash
braindead -h
```

Output:

```text
Usage: braindead [options] [command]


  Options:

    -V, --version  output the version number
    -h, --help     output usage information

  Commands:

    interact [options]           connect to server and open an interact shell
    exec <files>                 run client yaml script
    replicate [options] <files>  run replicator with an yaml script
```

## Interaction Mode

```text
Usage: interact [options]

  connect to server and open an interact shell


  Options:

    -H, --host <host>            client host (default: localhost)
    -P, --port <port>            client port
    -S, --ssl                    enable SSL
    -U, --uri <address>          uri
    -t, --timeout <miliseconds>  request timeout
    -h, --help                   output usage information
```

Example:

```bash
braindead interact -H localhost -P 3014
braindead interact -H localhost -P 3014 -S
braindead interact -U wss://localhost:3014
```

## Executor Mode

```text
Usage: exec [options] <files>

  run client yaml script


  Options:

    -h, --help  output usage information
```

Example:

```bash
braindead exec ./client.yaml
braindead exec ./client1.yaml,./client2.yaml
```

## Replicator Mode

```text
Usage: replicate [options] <files>

  run replicator with an yaml script


  Options:

    -i, --interval <miliseconds>           replicator intervel
    -c, --concurrency <count>              replicator concurrent count
    -l, --level <verbose|info|warn|error>  replicator log level
    -p, --prefix <prefix>                  replicator instance id prefix
    -o, --log <path>                       replicator log file path
    -h, --help                             output usage information
```

```bash
braindead replicate -o test.log -i 1000 -c 500 ./client.yaml
braindead replicate client1.yaml,client2.yaml,client3.yaml
```

## Yaml Scripting

### Examples:

```yaml
- connect:
    host: 'localhost'
    port: 3014
    ssl: true
    timeout: 5000
- emit:
    route: 'gate.handler.connect'
    data:
      udid: &udid '123456'
    expect:
      code: 200
    session:
      host: 'host'
      port: 'port'
- disconnect:
- sleep: 500
- connect:
    host: '$session.host'
    port: '$session.port'
    ssl: true
    timeout: 5000
- emit:
    route: 'connector.handler.login'
    data:
      udid: *udid
- emit: 'connector.handler.changeRoom'
- emit: 'room.roomHandler.enterRoom'
- emit: 'connector.handler.logout'
- disconnect:
```

```yaml
- connect:
    host: 'localhost'
    port: 3014
    ssl: true
    timeout: 30000
- emit:
    route: 'gate.handler.connect'
    data:
      udid: &udid '$args.name'
    expect:
      code: 200
    session:
      host: 'host'
      port: 'port'
- disconnect:
- sleep: 500
- connect:
    host: '$session.host'
    port: '$session.port'
    ssl: true
    timeout: 30000
- emit:
    route: 'connector.handler.login'
    data:
      udid: *udid
    expect:
      code: 200
- emit:
    route: 'connector.handler.changeRoom'
    expect:
      code: 200
- emit:
    route: 'room.roomHandler.enterRoom'
    expect:
      code: 200
- emit:
    route: 'room.userHandler.unlockSlot'
    data:
      slotId: 1
    expect:
      code: /200|400/
- sleep: 500
- emit:
    route: 'connector.handler.changeRoom'
    data:
      slotId: 1
      mode: 1
      type: 2
    expect:
      code: 200
- emit:
    route: 'room.roomHandler.enterRoom'
    expect:
      code: 200
- emit:
    route: 'room.slotsHandler.spin'
    data:
      bet: 1000
    expect:
      code: 200
    repeat:
      sleep: 6000
```

### Expressions

**connect**

```yaml
# connect to remote host
- connect:
    # hostname(required)
    host: 'localhost'
    # port(required)
    port: 9000
    # connection and request timeout in millisec(optional)
    timeout: 30000
```


**disconnect**

```yaml
# disconnect from remote host
- disconnect:
```


**emit**

```yaml
# a request without message body
- emit: 'room.roomHandler.enterRoom'
```

```yaml
# a request
- emit:
    # request route(required)
    route: 'connector.handler.login'
    # request data(optional)
    data:
      udid: '123456'
    # response test(optional)
    expect:
      # <var name in response>: <expected value>
      code: 200
      user:
        # string encoded with '/' will be treated as regex
        id: '/^__test__/'
    # write to session(optional)
    session:
      # <var name in session>: <path in response>
      id: 'user.id'
      name: 'user.name'
    # repeat(optional)
    repeat:
      # count(optional, omit to make infinite loop)
      count: 3
      # sleep for millisec before next repeat(optional)
      sleep: 6000
```


**sleep**

```yaml
# sleep for millisec
- sleep: 6000
```


#### Interpolation

`$session`, `$opts`, `$args`, `$env` can be used in `connect` and `emit`.

**$session**

Fetch variables stored in session.

```yaml
- connect:
    host: '$session.host'
    port: '$session.port'
```

```yaml
- emit:
    route: '$session.route'
```

```yaml
- emit:
    route: 'room.userHanlder.unlock'
    data:
      id: '$session.id'
```

**$opts**

Fetch variables stored in options. Available variables are `host`, `port`, `ssl`, `uri`, `timeout`, `interval`, `concurrency`, `level` and `prefix`.

**$args**

Fetch variables stored in arguments(replicator only). Available variables are `id`, `name` and `domain`.

```yaml
- emit:
    route: 'gate.handler.connect'
    data:
      udid: '$args.id'
    expect:
      code: 200
    session:
      host: 'host'
      port: 'port'
```

**$env**

Fetch variables stored in environment variables.


```yaml
- emit:
    route: 'room.userHanlder.check'
    data:
      env: '$env.NODE_ENV'
```