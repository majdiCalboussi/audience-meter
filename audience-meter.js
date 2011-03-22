var http = require('http'),
    url = require('url'),
    fs = require('fs'),
    io = require('socket.io'),
    net = require('net');

var DEBUG = process.argv.indexOf('-d') > 0,
    CMD_MAX_NAMESPACE_LEN = 50,
    CMD_MAX_NAMESPACE_LISTEN = 20,
    NAMESPACE_CLEAN_DELAY = 60000,
    NOTIFY_INTERVAL = 500;

var online = new function()
{
    var namespaces = {},
        $this = this;

    this.namespace = function(namespace_name, no_auto_create)
    {
        // Prefix namespace in order to prevent from overwriting Object internal properties
        var namespace = namespaces['@' + namespace_name];
        if (!namespace && !no_auto_create)
        {
            namespace = namespaces['@' + namespace_name] = {};
            namespace.created = Math.round(new Date().getTime() / 1000);
            namespace.members = 0;
            namespace.connections = 0;
            namespace.listeners = [];
            namespace.name = namespace_name;
        }
        return namespace;
    }

    this.clean_namespace = function(namespace)
    {
        if (namespace.members == 0 && namespace.listeners.length == 0)
        {
            namespace.garbageTimer = setTimeout(function()
            {
                delete namespaces['@' + namespace.name];
            }, NAMESPACE_CLEAN_DELAY);
        }
    }

    this.join = function(client, namespace_name)
    {
        var namespace = this.namespace(namespace_name);

        if (client.namespace)
        {
            if (client.namespace === namespace)
            {
                // Client subscribe to its current namespace, nothing to be done
                return;
            }

            this.leave(client);
        }

        if (namespace.garbageTimer)
        {
            clearTimeout(namespace.garbageTimer);
            delete namespace.garbageTimer;
        }
        namespace.members++;
        namespace.connections++;
        client.namespace = namespace;
    }

    this.leave = function(client)
    {
        if (client.namespace)
        {
            var namespace = client.namespace;
            namespace.members--;
            this.clean_namespace(namespace);
            delete client.namespace;
        }
    }

    this.listen = function(client, namespace_names)
    {
        this.unlisten(client);
        var info = {};
        namespace_names.forEach(function(namespace_name)
        {
            var namespace = $this.namespace(namespace_name);
            namespace.listeners.push(client);
            info[namespace.name] = namespace.members;
        });
        client.send(info);
    }

    this.unlisten = function(client)
    {
        for (var namespace_name in namespaces)
        {
            var namespace = namespaces[namespace_name];
            var listenerIdx = namespace.listeners.indexOf(client);
            if (listenerIdx !== -1)
            {
                namespace.listeners.splice(listenerIdx, 1);
                $this.clean_namespace(namespace);
            }
        }
    }

    this.remove = function(client)
    {
        this.leave(client);
        this.unlisten(client);
    }

    this.notify = function()
    {
        var listeners = [];
        for (var namespace_name in namespaces)
        {
            var namespace = namespaces[namespace_name];
            if (namespace.listeners.length === 0 || namespace.lastNotifiedValue === namespace.members)
            {
                // Only notify if there is some listeners a total members changed since the last notice
                continue;
            }
            namespace.listeners.forEach(function(listener)
            {
                if (!listener.bufferNotif) listener.bufferNotif = {};
                listener.bufferNotif[namespace.name] = namespace.members;
            });
            namespace.lastNotifiedValue = namespace.members;
            listeners = listeners.concat(namespace.listeners);
        }

        listeners.forEach(function(listener)
        {
            if (listener.bufferNotif)
            {
                listener.send(listener.bufferNotif);
                delete listener.bufferNotif;
            }
        });
    }

    this.info = function(namespace_name)
    {
        var namespace = this.namespace(namespace_name, false);
        return namespace ? namespace.members + ':' + namespace.connections : '0:0';
    }

    this.stats = function()
    {
        var stats = {};
        for (var namespace_name in namespaces)
        {
            var namespace = this.namespace(namespace_name.substr(1));
            stats[namespace.name] =
            {
                created: namespace.created,
                members: namespace.members,
                connections: namespace.connections
            };
        }
        return stats;
    }
}

setInterval(online.notify, NOTIFY_INTERVAL);

var demo;
fs.readFile('./demo.html', function (err, data)
{
    if (err) throw err; 
    demo = data.toString();
});


var server = http.createServer(function(req, res)
{
    var location = url.parse(req.url, true),
        path = location.pathname;

    if (path.substr(path.length - 5, 5) === '.json')
    {
        res.writeHead(200, {'Content-Type': 'application/json'});
        var jsonp = location.query.callback ? location.query.callback : location.query.jsonp;
        if (jsonp) res.write(jsonp + '(');
        if (path === '/stats.json')
        {
            res.write(JSON.stringify(online.stats()));
        }
        else
        {
            res.write(JSON.stringify(online.info(path.substr(0, path.length - 5))));
        }
        if (jsonp) res.write(')');
        res.end();
    }
    else
    {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end(demo.replace(/{hostname}/g, req.headers.host).replace(/{pathname}/g, path));
    }
});
server.listen(80);

var socket = io.listen(server, {log: DEBUG ? require('util').log : false});
socket.on('connection', function(client)
{
    client.on('message', function(data)
    {
        var join = null, listen = [];
        try
        {
            try
            {
                var command = JSON.parse(data);
            }
            catch(err)
            {
                throw 'Invalid JSON command';
            }
            if (command.join)
            {
                if (typeof command.join != 'string')
                {
                    throw 'Invalid join value: must be a string'
                }
                if (command.join.length > CMD_MAX_NAMESPACE_LEN)
                {
                    throw 'Maximum length for namespace is ' + CMD_MAX_NAMESPACE_LEN;
                }
                join = command.join;
            }
            if (command.listen)
            {
                if (typeof command.listen != 'object' || typeof command.listen.length != 'number')
                {
                    throw 'Invalid listen value: must be an array';
                }
                if (command.listen.length > CMD_MAX_NAMESPACE_LISTEN)
                {
                    throw 'Maximum listenable namespaces is ' + CMD_MAX_NAMESPACE_LISTEN;
                }
                command.listen.forEach(function(namespace)
                {
                    if (namespace.length > CMD_MAX_NAMESPACE_LEN)
                    {
                        throw 'Maximum length for namespace is ' + CMD_MAX_NAMESPACE_LEN;
                    }
                });
                listen = command.listen;
            }
        }
        catch (err)
        {
            client.send({err: err});
            return;
        }

        if (join)
        {
            online.join(client, join);
        }

        if (listen)
        {
            online.listen(client, listen);
        }
    });
    client.on('disconnect', function()
    {
        online.remove(client);
    });
});

// Port 1442 used to gather stats on all live namespaces (format: <namespace>:<created>:<members>:<connections>\n)
net.createServer(function(sock)
{
    var stats = online.stats();
    for (var namespace in stats)
    {
        var ns = stats[namespace];
        sock.write(namespace + ':' + ns.created + ':' + ns.members + ':' + ns.connections + '\n');
    }
    sock.end();
}).listen(1442, 'localhost');