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
    this.bodyData = {bodyText:"", bodyHTML:"", attachments:[]};
    
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
        data = this.parseBody(data);
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

    // format=fixed|flowed (RFC2646)
    this.headers.format = parts.format && parts.format.toLowerCase() || "fixed";
    
    // mime-boundary
    this.headers.multipart = false;
    this.headers.mimeBoundary = false;
    if(this.headers.contentType.substr(0,"multipart/".length)=="multipart/"){
        this.headers.mimeBoundary = parts.boundary;
        this.headers.multipart = true;
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
    this.body = {
        mimeContents: false,
        headersComplete: false,
        headers: "",
        i:0,
        list:[]
    }
    this.parseBody(data);
}

MailParser.prototype.parseBody = function(data){

    if(this.headers.multipart){
        var pos = pos2 = i = 0;
        do{
            if(this.body.mimeContents){
                
                // handle headers
                if(!this.body.headersComplete){
                    if((pos2 = data.indexOf("\r\n\r\n", pos))>=0){
                        this.body.headers += data.substring(pos, pos2);
                        pos = pos2+4;
                        this.body.headersComplete = true;
                        this.body.headerObj = mime.parseHeaders(this.body.headers.trim());
                        this.body.headers = "";
                        
                        this.body.list.push("HEADERS FOR ATTACHMENT #"+(++i)+":\n"+sys.inspect(this.body.headerObj, true, 5));
                    }else{
                        this.body.headers += data.substr(pos);
                        break;
                    }
                }

                // handle body
                // todo
            }
            
            pos = data.indexOf("--"+this.headers.mimeBoundary, pos);
            if(pos>=0){
                pos += ("--"+this.headers.mimeBoundary).length;
                this.body.headersComplete = false;
                this.body.headers = "";
                this.body.mimeContents = true;
                if(data.substr(pos,2)=="--"){
                    // last boundary
                    return;
                }
            }
        }while(pos>=0);
    }else{
        this.bodyData.bodyText += data;
    }
}

MailParser.prototype.parseBodyEnd = function(){
    
    if(!this.headers.multipart && this.bodyData.bodyText){
        switch(this.headers.contentTransferEncoding.toLowerCase()){
            case "quoted-printable":
                this.bodyData.bodyText = mime.decodeQuotedPrintable(this.bodyData.bodyText, false, this.headers.charset);
                break;
            case "base64":
                this.bodyData.bodyText = mime.decodeBase64(this.bodyData.bodyText, false, this.headers.charset);
                break;
        }
        this.bodyData.bodyText = this.bodyData.bodyText.trim();
        if(this.headers.contentType=="text/html"){
            this.bodyData.bodyHTML = this.bodyData.bodyText;
            this.bodyData.bodyText = false;
        }
    }
    
    if(this.bodyData.bodyText && !!this.bodyData.bodyHTML)
        this.bodyData.bodyText = stripHTML(this.bodyData.bodyText);
    
    this.emit("body",this.bodyData);
    console.log(this.body.list.join("\n\n"));
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
function Base64Stream(){
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


function stripHTML(str){
    str = str.replace(/\r?\n/g," ");
    str = str.replace(/<(?:\/p|br|\/tr|\/table|\/div)>/g,"\n");

    // hide newlines with two 00 chars (enables multiline matches)
    str = str.replace(/\r?\n/g,"-\u0000\u0000-");
    
    // H1-H6, add underline
    str = str.replace(/<[hH]\d[^>]*>(.*?)<\/[hH]\d[^>]*>/g,function(a,b){
        var line = "";
        b = b.replace(/<[^>]*>/g," ");
        b = b.replace(/\s\s+/g," ");
        b = b.trim();
        
        if(!b)
            return "";
        for(var i=0, len = b.length; i<len; i++){
            line+="-";
        }
        return b+"\n"+line+"\n\n";
    });

    // LI, indent by 2 spaces + *
    str = str.replace(/<li[^>]*>(.*?)<\/?(?:li|ol|ul)[^>]*>/ig,function(a,b){
        b = b.replace(/<[^>]*>/g," ");
        b = b.replace(/\s\s+/g," ");
        b = b.trim();
        
        if(!b)
            return "";
        return "-®®®®-* "+b+"\n";
    });

    // PRE, indent by 4 spaces
    str = str.replace(/<pre[^>]*>(.*?)<\/pre[^>]*>/ig,function(a,b){
        b = b.replace(/<[^>]*>/g," ");
        b = b.replace(/\s\s+/g," ");
        b = b.trim();
        
        if(!b)
            return "";

        b = b.replace(/[ \t]*\n[ \t]*/g,"\n-®®®®--®®®®-");
        
        return "\n-®®®®--®®®®-"+b.trim()+"\n\n";
    });

    // restore 
    str = str.replace(/\s*-\u0000\u0000-\s*/g,"\n");
    
    // remove all remaining html tags
    str = str.replace(/<[^>]*>/g," ");
    // remove duplicate spaces
    str = str.replace(/[ ][ ]+/g," ");
    // remove spaces before and after newlines
    str = str.replace(/[ \t]*\n[ \t]*/g,"\n");
    // remove more than 2 newlines in a row
    str = str.replace(/\n\n+/g,"\n\n");
    // restore hidden spaces (four (r) signs for two spaces)
    str = str.replace(/-®®®®-/g,"  ");
    return str.trim();
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