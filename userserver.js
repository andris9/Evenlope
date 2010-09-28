var rai = require("./rai"),
    auth = require("./auth");
    
var server = new rai.RaiServer({port: 777, greeting:function(instance){return "Hello to "+instance.socket.remoteAddress}});

server.addCommand("ADDUSER",function(data, response, context){
    var username;
    if(!data || !(username = data.trim())){
        if(!context.streamStep){
            return response("+ ", true);
        }
        return response("-ERR username needs to be set");
    }
    context.data.username = username
    response("+OK username accepted")
});

server.addCommand("ADDPASSWORD",function(data, response, context){
    var password = data?data.trim():"";
    if(!context.data.username){
        return response("-ERR username needs to be set");
    }
    context.data.password = password;
    
    auth.AuthServer.addUser(context.data.username,context.data.password, function(authres){
        if(!authres)
            return response("-ERR User '"+context.data.username+"' already exists")
        response ("+OK User '"+authres+"' created successfully");
    })
});

server.addCommand("EXIT",function(data, response, context){
    response("GOODBYE!");
    context.socket.end();
});