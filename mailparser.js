var EventEmitter = require('events').EventEmitter,
    sys = require('sys'),
    mime = require("./mime"),
    datetime = require("./datetime");

var PARSE_HEADERS = 1,
    PARSE_BODY = 2;

MailParser = function(mailFrom, rcptTo){
    this.mailFrom = mailFrom;
    this.rcptTo = rcptTo;
    this.headerStr = "";
    
    this.state = PARSE_HEADERS;
}

exports.MailParser = MailParser;

MailParser.prototype.feed = function(data){
    if(this.state == PARSE_HEADERS){
        data = this.parseHeaders(data);
        this.parseBodyStart(data);
    }else if(this.state == PARSE_BODY){
        data = this.parseBody(data, first);
    }
}

MailParser.prototype.end = function(){
    if(this.state == PARSE_BODY){
        console.log("MAILBODY: "+this.parseBodyEnd());
    }
}

MailParser.prototype.parseHeaders = function(data){
    var pos, body = "";
    if((pos=data.indexOf("\r\n\r\n"))>=0){
        this.headerStr += data.substr(0, pos);
        body = data.substr(pos+4);
        this.headerObj = mime.parseHeaders(this.headerStr);
        this.analyzeHeaders();
        this.state = PARSE_BODY;
    }else
        this.headerStr += data;
    return body;
}

MailParser.prototype.analyzeHeaders = function(){
    var parts, headersUsed = [];
    
    // mime version
    headersUsed.push("mime-version");
    this.useMime = !!parseFloat(this.headerObj["mime-version"] && this.headerObj["mime-version"][0]);
    
    // content type
    headersUsed.push("content-type");
    parts = {};
    if(this.headerObj["content-type"]){
        parts = parseHeaderLine(this.headerObj["content-type"] && this.headerObj["content-type"][0]);
    }
    this.contentType = parts.defaultValue && parts.defaultValue.toLowerCase() || "text/plain";
    
    // charset
    this.charset = parts.charset || "us-ascii";
    
    // mime-boundary
    if(this.contentType.substr(0,"multipart/".length)=="multipart/"){
        this.mimeBoundary = parts.boundary;
    }
    
    // message ID
    headersUsed.push("message-id");
    parts = {};
    if(this.headerObj["message-id"]){
        parts = parseHeaderLine(this.headerObj["message-id"] && this.headerObj["message-id"][0]);
    }
    this.messageId = (parts.defaultValue || "").replace(/^</, '').replace(/>*$/, '');
    
    // date
    headersUsed.push("date");
    parts = {};
    if(this.headerObj["date"]){
        parts = parseHeaderLine(this.headerObj["date"] && this.headerObj["date"][0]);
    }
    this.messageDate = parts.defaultValue && datetime.strtotime(parts.defaultValue)*1000 || Date.now();
    
    // content-transfer-encoding
    headersUsed.push("content-transfer-encoding");
    parts = {};
    if(this.headerObj["content-transfer-encoding"]){
        parts = parseHeaderLine(this.headerObj["content-transfer-encoding"] && this.headerObj["content-transfer-encoding"][0]);
    }
    this.contentTransferEncoding = parts.defaultValue || "7bit";
    
    // from
    headersUsed.push("from");
    this.addressesFrom = [];
    if(this.headerObj["from"]){
        for(var i=0, len = this.headerObj["from"].length;i<len; i++){
            this.addressesFrom = this.addressesFrom.concat(mime.parseAddresses(this.headerObj["from"][i]));
        }
    }
    
    // reply-to
    headersUsed.push("reply-to");
    this.addressesReplyTo = [];
    if(this.headerObj["reply-to"]){
        for(var i=0, len = this.headerObj["reply-to"].length;i<len; i++){
            this.addressesReplyTo = this.addressesReplyTo.concat(mime.parseAddresses(this.headerObj["reply-to"][i]));
        }
    }
    
    // to
    headersUsed.push("to");
    this.addressesTo = [];
    if(this.headerObj["to"]){
        for(var i=0, len = this.headerObj["to"].length;i<len; i++){
            this.addressesTo = this.addressesTo.concat(mime.parseAddresses(this.headerObj["to"][i]));
        }
    }
    
    // cc
    headersUsed.push("cc");
    this.addressesCc = [];
    if(this.headerObj["cc"]){
        for(var i=0, len = this.headerObj["cc"].length;i<len; i++){
            this.addressesCc = this.addressesCc.concat(mime.parseAddresses(this.headerObj["cc"][i]));
        }
    }
    
    // subject
    headersUsed.push("subject");
    if(this.useMime)
        this.subject = mime.decodeMimeWord(this.headerObj["subject"] && this.headerObj["subject"][0] || "");
    else
        this.subject = this.headerObj["subject"] && this.headerObj["subject"][0] || "";
   
    this.headersSecondary = [];
    var keys = Object.keys(this.headerObj);
    for(var i=0, len=keys.length; i<len; i++){
        if(headersUsed.indexOf(keys[i])<0){
            var row = {};
            row.name = keys[i];
            row.value = this.headerObj[keys[i]];
            this.headersSecondary.push(row);
        }
    }
    
    delete this.headerObj; // not needed anymore
    delete this.headerStr; // just ditch it
    
    console.log(this);
    console.log(new Date(this.messageDate));
}

MailParser.prototype.parseBodyStart = function(data){
    this.bodyData = {defaultBody:""};
    this.mimeContents = false;
    
    this.parseBody(data);
}

MailParser.prototype.parseBody = function(data){
    var pos;
    
    if(this.mimeBoundary){
        pos  = data.indexOf("--"+this.mimeBoundary);
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
    return false;
}



// StorageItemStream - load text into memory, put binary to Mongo GridStore
// return a) text - fulltext, b) binary - key
function StorageItemStream(type, encoding, charset){
    EventEmitter.call(this);
    this.type = type || "text";
    this.encoding = encoding || "7bit";
    this.charset = charset || "us-ascii";
    this.data = "";
}
sys.inherits(this.StorageItemStream, EventEmitter);

StorageItemStream.prototype.feed = function(data){
    if(this.type=="text")this.feedText(data);
    if(this.type=="binary")this.feedBinary(data);
}

StorageItemStream.prototype.feedText = function(data){
    this.data += data;
}

StorageItemStream.prototype.feedBinary = function(data){
    
}

StorageItemStream.prototype.end = function(){
    if(this.type=="text"){
        if(this.encoding=="quoted-printable")
            this.data = mime.decodeQuotedPrintable(this.data, false, this.charset);
        if(this.encoding=="base64")
            this.data = mime.decodeBase64(this.data, this.charset);
    }
    this.emit("end", this.data);
}


// base64 stream decoder
this.Base64Stream = function(){
    EventEmitter.call(this);
    this.current = "";
}
sys.inherits(this.Base64Stream, EventEmitter);

this.Base64Stream.prototype.push = function(data){
    var remainder = 0;
    this.current += data.replace(/[^\w+\/=]/g,'');
    this.emit("stream", new Buffer(this.current.substr(0, this.current.length - this.current.length % 4),"base64"));
    this.current = (remainder=this.current.length % 4)?this.current.substr(- remainder):"";
}

this.Base64Stream.prototype.end = function(){
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