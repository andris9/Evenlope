var EventEmitter = require('events').EventEmitter,
    sys = require('sys'),
    mime = require("./mime"),
    datetime = require("./datetime");

var PARSE_HEADERS = 1,
    PARSE_BODY = 2;

MailParser = function(mailFrom, rcptTo){
    EventEmitter.call(this);
    this.mailFrom = mailFrom;
    this.rcptTo = rcptTo;
    this.headerStr = "";
 
    this.headers = {};
    this.bodyData = {defaultBody:"", attachments:[]};
    
    this.state = PARSE_HEADERS;
}
sys.inherits(MailParser, EventEmitter);

exports.MailParser = MailParser;

MailParser.prototype.feed = function(data){
    data = data.replace(/\r\n\.\./g,"\r\n.");
    if(this.state == PARSE_HEADERS){
        data = this.parseHeaders(data);
        this.parseBodyStart(data);
    }else if(this.state == PARSE_BODY){
        data = this.parseBody(data, first);
    }
}

MailParser.prototype.end = function(){
    if(this.state == PARSE_BODY){
        this.parseBodyEnd();
    }
    this.emit("end");
}

MailParser.prototype.parseHeaders = function(data){
    var pos, body = "";
    if((pos=data.indexOf("\r\n\r\n"))>=0){
        this.headerStr += data.substr(0, pos);
        body = data.substr(pos+4);
        this.headerObj = mime.parseHeaders(this.headerStr);
        this.analyzeHeaders();
        this.emit("headers", this.headers);
        this.state = PARSE_BODY;
    }else
        this.headerStr += data;
    return body;
}

MailParser.prototype.analyzeHeaders = function(){
    var parts, headersUsed = [];
    
    // mime version
    headersUsed.push("mime-version");
    this.headers.useMime = !!parseFloat(this.headerObj["mime-version"] && this.headerObj["mime-version"][0]);
    
    // content type
    headersUsed.push("content-type");
    parts = {};
    if(this.headerObj["content-type"]){
        parts = parseHeaderLine(this.headerObj["content-type"] && this.headerObj["content-type"][0]);
    }
    this.headers.contentType = parts.defaultValue && parts.defaultValue.toLowerCase() || "text/plain";
    
    // charset
    this.headers.charset = parts.charset || "us-ascii";
    
    // mime-boundary
    if(this.headers.contentType.substr(0,"multipart/".length)=="multipart/"){
        this.headers.mimeBoundary = parts.boundary;
    }
    
    // message ID
    headersUsed.push("message-id");
    parts = {};
    if(this.headerObj["message-id"]){
        parts = parseHeaderLine(this.headerObj["message-id"] && this.headerObj["message-id"][0]);
    }
    this.headers.messageId = (parts.defaultValue || "").replace(/^</, '').replace(/>*$/, '');
    
    // date
    headersUsed.push("date");
    parts = {};
    if(this.headerObj["date"]){
        parts = parseHeaderLine(this.headerObj["date"] && this.headerObj["date"][0]);
    }
    this.headers.messageDate = parts.defaultValue && datetime.strtotime(parts.defaultValue)*1000 || Date.now();
    
    // content-transfer-encoding
    headersUsed.push("content-transfer-encoding");
    parts = {};
    if(this.headerObj["content-transfer-encoding"]){
        parts = parseHeaderLine(this.headerObj["content-transfer-encoding"] && this.headerObj["content-transfer-encoding"][0]);
    }
    this.headers.contentTransferEncoding = parts.defaultValue || "7bit";
    
    // from
    headersUsed.push("from");
    this.headers.addressesFrom = [];
    if(this.headerObj["from"]){
        for(var i=0, len = this.headerObj["from"].length;i<len; i++){
            this.headers.addressesFrom = this.headers.addressesFrom.concat(mime.parseAddresses(this.headerObj["from"][i]));
        }
    }
    
    // reply-to
    headersUsed.push("reply-to");
    this.headers.addressesReplyTo = [];
    if(this.headerObj["reply-to"]){
        for(var i=0, len = this.headerObj["reply-to"].length;i<len; i++){
            this.headers.addressesReplyTo = this.headers.addressesReplyTo.concat(mime.parseAddresses(this.headerObj["reply-to"][i]));
        }
    }
    
    // to
    headersUsed.push("to");
    this.headers.addressesTo = [];
    if(this.headerObj["to"]){
        for(var i=0, len = this.headerObj["to"].length;i<len; i++){
            this.headers.addressesTo = this.headers.addressesTo.concat(mime.parseAddresses(this.headerObj["to"][i]));
        }
    }
    
    // cc
    headersUsed.push("cc");
    this.headers.addressesCc = [];
    if(this.headerObj["cc"]){
        for(var i=0, len = this.headerObj["cc"].length;i<len; i++){
            this.headers.addressesCc = this.headers.addressesCc.concat(mime.parseAddresses(this.headerObj["cc"][i]));
        }
    }
    
    // subject
    headersUsed.push("subject");
    if(this.headers.useMime)
        this.headers.subject = mime.decodeMimeWord(this.headerObj["subject"] && this.headerObj["subject"][0] || "");
    else
        this.headers.subject = this.headerObj["subject"] && this.headerObj["subject"][0] || "";
   
    this.headers.secondary = [];
    var keys = Object.keys(this.headerObj);
    for(var i=0, len=keys.length; i<len; i++){
        if(headersUsed.indexOf(keys[i])<0){
            var row = {};
            row.name = keys[i];
            row.value = this.headerObj[keys[i]];
            this.headers.secondary.push(row);
        }
    }
    
    delete this.headerObj; // not needed anymore
    delete this.headerStr; // just ditch it
}

MailParser.prototype.parseBodyStart = function(data){
    this.mimeContents = false;
    
    this.parseBody(data);
}

MailParser.prototype.parseBody = function(data){
    var pos;
    
    if(this.headers.mimeBoundary){
        pos  = data.indexOf("--"+this.headers.mimeBoundary);
        if(pos>=0){
            if(!this.mimeContents) // between mime attachments
                this.bodyData.defaultBody += data.substr(0,pos).trim();
            else{// end mime part
                
            }
        }
    }else{
        
    }
}

MailParser.prototype.parseBodyEnd = function(){
    this.emit("body",this.bodyData);
    return false;
}



// DataStore - load text into memory, put binary to Mongo GridStore
// return a) text - fulltext, b) binary - key
function DataStore(type, encoding, charset){
    EventEmitter.call(this);
    this.type = type || "text";
    this.encoding = encoding || "7bit";
    this.headers.charset = charset || "us-ascii";
    this.data = "";
}
sys.inherits(DataStore, EventEmitter);

DataStore.prototype.feed = function(data){
    if(this.type=="text")this.feedText(data);
    if(this.type=="binary")this.feedBinary(data);
}

DataStore.prototype.feedText = function(data){
    this.data += data;
}

DataStore.prototype.feedBinary = function(data){
    
}

DataStore.prototype.end = function(){
    if(this.type=="text"){
        if(this.encoding=="quoted-printable")
            this.data = mime.decodeQuotedPrintable(this.data, false, this.headers.charset);
        if(this.encoding=="base64")
            this.data = mime.decodeBase64(this.data, this.headers.charset);
    }
    this.emit("end", this.data);
}


// base64 stream decoder
Base64Stream = function(){
    EventEmitter.call(this);
    this.current = "";
}
sys.inherits(Base64Stream, EventEmitter);

Base64Stream.prototype.push = function(data){
    var remainder = 0;
    this.current += data.replace(/[^\w+\/=]/g,'');
    this.emit("stream", new Buffer(this.current.substr(0, this.current.length - this.current.length % 4),"base64"));
    this.current = (remainder=this.current.length % 4)?this.current.substr(- remainder):"";
}

Base64Stream.prototype.end = function(){
    if(this.current.length)
        this.emit("stream", new Buffer(this.current,"base64"));
    this.emit("end");
}


function parseHeaderLine(line){
    if(!line)
        return {};
    var result = {}, parts = line.split(";"), pos;
    for(var i=0, len = parts.length; i<len; i++){
        pos = parts[i].indexOf("=");
        if(pos<0){
            result[!i?"defaultValue":"i-"+i] = parts[i].trim();
        }else{
            result[parts[i].substr(0,pos).trim().toLowerCase()] = parts[i].substr(pos+1).trim();
        }
    }
    return result;
}