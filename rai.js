var net = require('net'),
    crypto = require('crypto');

var NORMAL = 1,
    DATASTREAM = 2;

/**
 * new exports.RaiServer(options)
 * - options (Object): Server options
 * 
 * Creates a Request-Answer-Interface server to handle simple
 * text based protocol TCP servers
 **/
var RaiServer = function(options){
    options = options || {};
    this.port = options.port || 80;

    this.onGreeting = options.onGreeting;
    this.onSecure = options.onSecure;
    this.onClientError = options.onClientError;

    this.credentials = options.credentials;
    if(!this.credentials && options.privateKey && options.certificate){
        this.credentials = crypto.createCredentials({
            key: options.privateKey.toString("ascii"),
            cert: options.certificate.toString("ascii")
        });
    }
    this.useTLS = options.credentials && options.useTLS;
    this.init();
}

exports.RaiServer = RaiServer;

RaiServer.prototype.init = function(){
    this.server = net.createServer(this.createServer.bind(this));
    this.server.listen(this.port);
    
    this.commands = {};
}

RaiServer.prototype.createServer = function(socket){
    return new RaiInstance(this, socket);
}


RaiServer.prototype.addCommand = function(name, callback){
    if(typeof name=="string" && typeof callback=="function")
        this.commands[name.trim().toUpperCase()] = callback;
}


var RaiInstance = function(server, socket){
    this.server = server;
    this.socket = socket;
    
    this.state = NORMAL;
    this.dataStreamCommand = null;
    this.streamStep = 0;
    
    this.data = {};
    
    this.secureConnection = false;
    
    if(this.server.useTLS && this.server.credentials)
        this.socket.setSecure(this.server.credentials);
    
    this.setHandlers();
    
    if(this.server.onGreeting){
        if(typeof this.server.onGreeting=="function"){
            this.responseToClient(this.server.onGreeting(this));
        }
        if(typeof this.server.onGreeting=="string"){
            this.responseToClient(this.server.onGreeting);
        }
    }
}


RaiInstance.prototype.setHandlers = function(){
    this.socket.on("data", this.receiveData.bind(this));
    this.socket.on("end", this.endSocket.bind(this));
    this.socket.on("secure", this.secureConnectionOpened.bind(this));
}

RaiInstance.prototype.receiveData = function(data){
    var request = data.toString("ascii", 0, data.length);
    console.log("CLIENT: "+request.trim());
    this.parseIncoming(request);
}

RaiInstance.prototype.responseToClient = function(data){
    var response = new Buffer(data + "\r\n", "ascii");
    console.log("SERVER: "+data);
    this.socket.write(response);
}

RaiInstance.prototype.parseIncoming = function(request){
    if(this.state == DATASTREAM){
        if(this.dataStreamCommand){
            this.streamStep++;
            this.runCommand(this.dataStreamCommand, request);
            return;
        }else{
            this.state = NORMAL;
        }
    }else{
        var parts = request.split(" "),
            command = parts && parts[0] && parts.shift().trim().toUpperCase(),
            payload = command && parts.length && parts.join(" ");
        if(command){
            this.runCommand(command, payload);
            return;
        }
    }
    this.sendError("Unknown error");
    return;
}

RaiInstance.prototype.runCommand = function(name, payload){
    //console.log("Command: "+name+", with '"+(payload?payload.trim():"-")+"'");
    
    if(this.server.commands[name]){
        this.server.commands[name](payload, (function(response, useStream, setSecure){
            this.responseToClient(response);
            if(useStream){
                this.state = DATASTREAM;
                this.dataStreamCommand = name;
            }else if(this.state == DATASTREAM){
                this.state = NORMAL;
                this.streamStep = 0;
            }
            if(setSecure && !this.secureConnection && this.server.credentials)
                this.socket.setSecure(this.server.credentials);
            
        }).bind(this), this);
        return;
    }
    
    this.sendError();
}

RaiInstance.prototype.endSocket = function(){
    console.log("Connection closed");
    this.destroy();
}

RaiInstance.prototype.secureConnectionOpened = function(){
    console.log("Secure connection established");
    this.secureConnection = true;
    if(typeof this.server.onSecure=="function"){
        this.server.onSecure(this);
    }
}

RaiInstance.prototype.destroy = function(){
    console.log("Clearing all instance data");
}

RaiInstance.prototype.sendError = function(err){
    if(typeof this.server.onClientError=="function"){
        this.responseToClient(this.server.onClientError(err, this));
    }else
        this.responseToClient("-ERR"+(err?" "+err:""));
}

/*
var server = new RaiServer({port:777});

server.addCommand("TERE",function(data, response, step){
    console.log("Received data: "+data);
    response("OKIDOKI! "+step, step<3);
});

server.addCommand("pere",function(data, response, step){
    console.log("Perceived data: "+data);
    response("OKIDOKI!");
});
*/