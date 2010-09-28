var rai = require("./rai"),
    auth = require("./auth");

var __incrementator = 0;

var STATE_AUTHENTICATION = 1,
    STATE_TRANSACTION = 2,
    STATE_UPDATE = 3

var CAPA_AUTHENTICATION  = ["UIDL", "USER", "RESP-CODES", "AUTH-RESP-CODE"],
    CAPA_TRANSACTION     = ["UIDL", "EXPIRE NEVER", "LOGIN-DELAY 0", "IMPLEMENTATION N3 node.js POP3 server"],
    CAPA_UPDATE          = [];
    
var POP3Server = function(options){
    options = options || {};
    if(!options.port)options.port = 110;
    this.options = options;
    
    this.options.onGreeting = this.onGreeting.bind(this);
    this.options.onSecure = this.onSecure.bind(this);
    this.options.onClientError = this.onClientError.bind(this);
    
    // Create Request-Answer-Interface server
    this.raiServer = new rai.RaiServer(options);
    
    this.capabilities = {};
    this.capabilities[STATE_AUTHENTICATION] = Object.create(CAPA_AUTHENTICATION);
    this.capabilities[STATE_TRANSACTION] = Object.create(CAPA_TRANSACTION);
    this.capabilities[STATE_UPDATE] = Object.create(CAPA_UPDATE);
    
    // If not TLS mode but has the capability, add STLS to the capabilities list
    if(!this.options.useTLS && (this.options.credentials || (this.options.privateKey && this.options.certificate))){
        this.capabilities[STATE_AUTHENTICATION].unshift("STLS"); // Only in auth.
    }
    
    this.setUpRaiCommands();
}

POP3Server.prototype.onSecure = function(client){}

POP3Server.prototype.onClientError = function(err, client){
    if(err)
        return "-ERR "+err;
    else
        return "-ERR ???"
}

POP3Server.prototype.onClientOK = function(msg, client){
    if(msg)
        return "+OK "+msg;
    else
        return "+OK ???"
}

POP3Server.prototype.onGreeting = function(client){
    client.data.instanceID = ++__incrementator;
    client.data.pop3_state = STATE_AUTHENTICATION;
    return "+OK POP3 Server ready to serve "+client.socket.remoteAddress; // No APOP possibility
}

POP3Server.prototype.setUpRaiCommands = function(){
    var keys = Object.keys(this.commands);
    for(var i=0, len=keys.length; i<len; i++){
        this.raiServer.addCommand(keys[i], this.commands[keys[i]].bind(this));
    }
}

POP3Server.prototype.makeLogin = function(client){
    client.data.pop3_state = STATE_TRANSACTION;
}

POP3Server.prototype.checkAuth = function(password, client){
    auth.AuthServer.authUser(client.data.username, password, (function(status){
        if(status){
            this.makeLogin(client);
            response(this.onClientOK("User accepted, You are now logged in"));
        }else{
            delete client.data.username;
            response(this.onClientError("[AUTH] Invalid login"));
        }
    }).bind(this))
}

POP3Server.prototype.commands = {
    CAPA: function(data, response, client){
        response(this.onClientOK("Capability list follows"));
        for(var i=0, len = this.capabilities[client.data.pop3_state].length;i<len;i++){
            response(this.capabilities[client.data.pop3_state][i]);
        }
        response(".");
    },
    
    QUIT: function(data, response, client){
        response("Goodbye!");
        client.socket.end();
    },
    
    USER: function(data, response, client){
        if(client.data.pop3_state != STATE_AUTHENTICATION)
            return response(this.onClientError("Only allowed in authentication mode"));
        
        // Check for secure connection. Currently not implemented since it's really hard
        // to test anything in telnet when secure connection is needed
        
        var username = data && data.trim();
        if(!username)
            return response(this.onClientError("User not set, try: USER <username>"));
        client.data.username = username;
        response(this.onClientOK("User accepted"));
    },
    
    PASS: function(data, response, client){
        if(client.data.pop3_state != STATE_AUTHENTICATION)
            return response(this.onClientError("Only allowed in authentication mode"));
        if(!client.data.username)
            return response(this.onClientError("USER not yet set, try: USER <username>"));
        
        // Check for authentication
        this.checkAuth(data?data.trim():"", client);
    }
}

new POP3Server();