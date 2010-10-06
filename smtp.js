var rai = require("./rai"),
    auth = require("./auth"),
    dns = require('dns'),
    mailparser = require('./mailparser'),
    sys = require('sys');

var __incrementator = 0;

var SMTPServer = function(options){
    options = options || {};
    if(!options.port)options.port = 25;
    this.options = options;
    
    this.options.onGreeting = this.onGreeting.bind(this);
    this.options.onSecure = this.onSecure.bind(this);
    this.options.onClientError = this.onClientError.bind(this);
    
    this.domainName = options.domainName || "localhost";
    this.capabilities = ["SIZE 10240000"];
    
    // If not TLS mode but has the capability, add STLS to the capabilities list
    if(!this.options.useTLS && (this.options.credentials || (this.options.privateKey && this.options.certificate))){
        this.capabilities.push("STARTTLS"); // Only in auth.
    }
    
    // Create Request-Answer-Interface server
    this.raiServer = new rai.RaiServer(options);
    
    this.setUpRaiCommands();
}

SMTPServer.prototype.onSecure = function(client){}

SMTPServer.prototype.onClientError = function(err, client){
    if(err)
        return "502 "+err;
    else
        return "502 Sorry"
}

SMTPServer.prototype.onGreeting = function(client){
    client.data.instanceID = ++__incrementator;
    client.data.rcptList = [];
    return "220 fw.node.ee ESMTP N3";
}

SMTPServer.prototype.setUpRaiCommands = function(){
    var keys = Object.keys(this.commands);
    for(var i=0, len=keys.length; i<len; i++){
        this.raiServer.addCommand(keys[i], this.commands[keys[i]].bind(this));
    }
}


SMTPServer.prototype.receiveHeaders = function(headers){
    console.log("Mail headers:")
    console.log(sys.inspect(headers,false, 5));
}

SMTPServer.prototype.receiveBody = function(body){
    console.log("FINAL MAIL BODY:")
    console.log(sys.inspect(body, false, 5));
}

SMTPServer.prototype.commands = {
    HELO: function(data, response, client){
        var domain = data && data.trim();
        if(!domain)
            return response("501 Error: HELO requires domain address");
        client.data.domain = domain;
        response("250 Hello "+domain+", I am glad to meet you");
    },
    
    EHLO: function(data, response, client){
        var domain = data && data.trim();
        if(!domain)
            return response("501 Error: EHLO requires domain address");
        client.data.domain = domain;
        
        response("250"+(this.capabilities.length?"-":" ")+this.domainName);
        for(var i=0, len = this.capabilities.length; i<len; i++){
            response("250"+(i==len-1?" ":"-")+this.capabilities[i]);
        }
    },
    
    MAIL: function(data, response, client){
        if(!client.data.domain)
            return response("503 Error: Send HELO/EHLO first");
        
        // Check if MAIL FROM: was already issued
        if(client.data.mailFrom)
            return response("503 Error: Nested MAIL command");
        
        // Check if command syntax is OK
        data = data && data.trim();
        var address = data && data.substr("FROM:".length).trim();
        if(!data || !address || data.substr(0,"FROM:".length).toUpperCase()!="FROM:")
            return response("501 Error: Syntax: MAIL FROM:<address>");
        
        // Check if address is enclosed with < and >
        if(address.length<=2 || address.charAt(0)!="<" || address.charAt(address.length-1)!=">")
            return response("501 Error: Bad sender address syntax");
        
        // Check if mail address validates by RFC822
        address = address.substr(1, address.length-2).trim();
        if(!validateEmail(address))
            return response("504 <"+address+">: Sender address rejected: need fully-qualified address");
        
        var parts = address.split("@"),
            user = parts[0],
            domain = parts[1];
        
        // Check if domain exists
        dns.resolveMx(domain, function(err, addresses){
            if(err || !addresses || !addresses.length)
                return response("450 <"+address+">: Sender address rejected: Domain not found");
           
            // SEEMS THAT EVERYTHING OS OK WITH THE ADDRESS!
            client.data.mailFrom = address;
            response("250 OK");            
        });
    },
    
    RCPT: function(data, response, client){
        // Check if MAIL FROM: is issued
        if(!client.data.mailFrom)
            return response("503 Error: Need MAIL command");
        
        // Check if command syntax is OK
        data = data && data.trim();
        var address = data && data.substr("TO:".length).trim();
        if(!data || !address || data.substr(0,"TO:".length).toUpperCase()!="TO:")
            return response("501 Error: Syntax: RCPT TO:<address>");
        
        // Check if address is enclosed with < and >
        if(address.length<=2 || address.charAt(0)!="<" || address.charAt(address.length-1)!=">")
            return response("501 Error: Bad recipient address syntax");
        
        address = address.substr(1, address.length-2).trim();
        
        // Check if local address
        if(address.indexOf("@")<0){
            // Reject all
            return response("550 <"+address+">: Recipient address rejected: User unknown in local recipient table");
        }
        
        // Check if mail address validates by RFC822
        if(!validateEmail(address))
            return response("504 <"+address+">: Recipient address rejected: need fully-qualified address");
        
        var parts = address.split("@"),
            user = parts[0],
            domain = parts[1];
        
        // Check if domain exists
        dns.resolveMx(domain, function(err, addresses){
            if(err || !addresses || !addresses.length)
                return response("450 <"+address+">: Recipient address rejected: Domain not found");
           
            // SEEMS THAT EVERYTHING OS OK WITH THE ADDRESS!
            if(client.data.rcptList.indexOf(address)<0) // Checks if already exists
                client.data.rcptList.push(address);
            response("250 OK");
        });
    },
    
    DATA: function(data, response, client){
        if(!client.streamStep){ // NORMAL
            // Check if MAIL FROM: is issued
            if(!client.data.mailFrom)
                return response("503 Error: Need RCPT command");
            
            // Check if no valid recipients
            if(!client.data.rcptList.length)
                return response("503 Error: No valid recipients");
        
            client.data.mailParser = new mailparser.MailParser(client.data.mailFrom, client.data.rcptList);
            client.data.mailParser.on("headers", this.receiveHeaders.bind(this));
            client.data.mailParser.on("body", this.receiveBody.bind(this));
            
            return response("354 End data with <CR><LF>.<CR><LF>", true);
        }else{ // STREAM
            if(data.substr(-5)=="\r\n.\r\n"){
                client.data.mailParser.feed(data.substr(0,(data.length-5)));
                client.data.mailParser.end();
                response("250 OK Mail received");
            }else
                client.data.mailParser.feed(data);
        }
    },
    
    STATUS: function(data, response, client){
        if(!client.data.mailFrom)
            return response("No data yet")
        response("FROM: "+client.data.mailFrom);
        for(var i=0; i<client.data.rcptList.length;i++){
            response("TO: "+client.data.rcptList[i]);
        }
    },
    
    STARTTLS: function(data, response, client){
        if(this.capabilities.indexOf("STARTTLS")<0)
            return response("502 Not implemented");
        if(data)
            return response("501 Syntax error (no parameters allowed)");
        response("220 Ready to start TLS", false, true); // initiate secure connection
    },
    
    NOOP: function(data, response, client){
        response("250 OK");
    },
    
    QUIT: function(data, response, client){
        response("221 Goodbye"+(client.data.domain?", "+client.data.domain+"!":""));
        client.socket.end();
    }
}

// RFC822 compatible regex from http://www.ex-parrot.com/~pdw/Mail-RFC822-Address.html
// 6kB regex might be overkill though
var email_validation_regex_cached = /(?:(?:\r\n)?[ \t])*(?:(?:(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*))*@(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*|(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)*\<(?:(?:\r\n)?[ \t])*(?:@(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*(?:,@(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*)*:(?:(?:\r\n)?[ \t])*)?(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*))*@(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*\>(?:(?:\r\n)?[ \t])*)|(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)*:(?:(?:\r\n)?[ \t])*(?:(?:(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*))*@(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*|(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)*\<(?:(?:\r\n)?[ \t])*(?:@(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*(?:,@(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*)*:(?:(?:\r\n)?[ \t])*)?(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*))*@(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*\>(?:(?:\r\n)?[ \t])*)(?:,\s*(?:(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*))*@(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*|(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)*\<(?:(?:\r\n)?[ \t])*(?:@(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*(?:,@(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*)*:(?:(?:\r\n)?[ \t])*)?(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|"(?:[^\"\r\\]|\\.|(?:(?:\r\n)?[ \t]))*"(?:(?:\r\n)?[ \t])*))*@(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*)(?:\.(?:(?:\r\n)?[ \t])*(?:[^()<>@,;:\\".\[\] \000-\031]+(?:(?:(?:\r\n)?[ \t])+|\Z|(?=[\["()<>@,;:\\".\[\]]))|\[([^\[\]\r\\]|\\.)*\](?:(?:\r\n)?[ \t])*))*\>(?:(?:\r\n)?[ \t])*))*)?;\s*)/;
function validateEmail(email){
    return !!(email && email.match(email_validation_regex_cached));
}


var pkFilename  = "./cert/privatekey.pem",  // PATH TO PRIVATE KEY
    crtFilename = "./cert/certificate.pem",
    fs = require("fs");

new SMTPServer({privateKey:fs.readFileSync(pkFilename), certificate:fs.readFileSync(crtFilename)});