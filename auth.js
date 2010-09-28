var redis = require("redis"),
    crypto = require('crypto');

/**
 * exports.AuthServer
 * 
 * Handles users/passwords and sessions
 **/
this.AuthServer = {
    
    /**
     * exports.AuthServer.expire_time -> Number
     * 
     * Session expiration time in seconds
     **/
    expire_time: 1*3600,
    
    /**
     * exports.AuthServer.redis -> Object
     * 
     * Pointer to a Redis Database client
     **/
    redis: redis.createClient(),
    
    /**
     * exports.AuthServer.getNewId(callback) -> undefined
     * - callback (Function): runs after generating the ne ID.
     * 
     * Generates a new incremental unique ID. 
     **/
    getNewID: function(callback){
        this.redis.incr("next.user.id", function(err, response){
            callback(!err && response);
        });
    },
    
    /**
     * exports.AuthServer.addUser(username, password, callback) -> undefined
     * - username (String): Username for the new user
     * - password (String): Password for the nw user
     * - callback (Function): function to be run with the resulting data
     * 
     * Creates a new user. If user exists callback response will be false
     **/
    addUser: function(username, password, callback){
        var id = "user:"+sha1(username);
        this.redis.setnx(id, username+"\u0000"+sha1(password), function(err, response){
            if(err || !response)
                return callback(false);
            if(response)
                return callback(username);
        });
    },
    
    /**
     * exports.AuthServer.getUser(username, callback) -> undefined
     * - username (String): username to be checked for existance
     * - callback (Function): callback to be run with the result
     * 
     * Checks if an user exists and returns username+\0+passwordHash
     **/
    getUser: function(username, callback){
        var id = "user:"+sha1(username);
        this.redis.get(id, function(err, response){
            return callback(!err && response.toString("utf-8"));
        });
    },
    
    /**
     * exports.AuthServer.authUser(username, password, callback) -> undefined
     * - username (String): username to be checked
     * - password (String): password of the user to be checkec
     * - callback (Function): callback to be run with the result
     * 
     * Authenticates a user with username and password. Callback will be run
     * with TRUE/FALSE according to the success of the authentication.
     **/
    authUser: function(username, password, callback){
        this.getUser(username, (function(response){
            if(!response)
                return callback(false);
            else{
                var hash = response.substr(username.length+1);
                return callback(hash == sha1(password)?username:false);
            }
        }).bind(this));
    },
    
    /**
     * exports.AuthServer.updateUser(username, password, callback) -> undefined
     * - username (String): Username to be updated
     * - password (String): New password for this user
     * - callback (Function): callback to be run with the result
     * 
     * Changes users password.
     **/
    updateUser: function(username, password, callback){
        this.getUser(username, (function(response){
            if(!response)
                return callback(false);
            else{
                var id = "user:"+sha1(username);
                this.redis.set(id, username+"\u0000"+sha1(password), function(err, response){
                    if(err || !response)
                        return callback(false);
                    if(response)
                        return callback(username);
                });
            }
        }).bind(this));
    },
    
    /**
     * exports.AuthServer.removeUser(username, callback) -> undefined
     * - username (String): Username to be removed
     * - callback (Function): callback to be run with the result
     * 
     * Removes a user from the user base. All related sessions will stop
     * working since user existance is checked
     **/
    removeUser: function(username, callback){
        var id = "user:"+sha1(username);
        this.redis.del(id, function(err, response){
            return callback(!err && !!response);
        });
    },
    
    /**
     * exports.AuthServer.startSession(username, password, callback) -> undefined
     * - username (String): username to be checked
     * - password (String): password to be checked
     * - callback (Function): callback to be run with the session key
     * 
     * Authenticates a user and creates a new session. Returns session key
     * with callback if the authentication was successful
     **/
    startSession: function(username, password, callback){
        this.authUser(username, password, (function(response){
            if(!response)
                return callback(false);
            var sessid = sha1(username+password+Date.now()+Math.random()),
                sesskey = "sesskey:"+sessid;
            this.redis.setnx(sesskey, username, (function(err, response){
                if(err) // improbable case where the same sesskey exists
                    return callback(false);
                this.redis.expire(sesskey,this.expire_time, function(err, response){
                    if(err)
                        return callback(false);
                    callback(sessid);
                });
            }).bind(this));
        }).bind(this));
    },
    
    /**
     * exports.AuthServer.checkSession(sessid, callback) -> undefined
     * - sessid (String): Session key (SHA1 hash)
     * - callback (Function): callback to be run with the session data
     * 
     * Checks if a session with this key exists and return username of the
     * logged in user.
     **/
    checkSession: function(sessid, callback){
        var sesskey = "sesskey:"+sessid;
        this.redis.get(sesskey, (function(err, response){
            var username = !err && response.toString("utf-8");
            if(!username)
                return callback(false);
            
            // Check if the user still exists
            this.getUser(username, function(response){
                return callback(response);
            });
        }).bind(this));
    },
    
    /**
     * exports.AuthServer.removeSession(sessid, callback) -> undefined
     * - sessid (String): Session key (SHA1 hash)
     * - callback (Function): callback to be run with the response data
     * 
     * Deletes an existing session
     **/
    removeSession: function(sessid, callback){
        var sesskey = "sesskey:"+sessid;
        this.redis.del(sesskey, (function(err, response){
            return callback(!err && !!response);
        }).bind(this));
    },
    
    /**
     * exports.AuthServer.stop() -> undefined
     * 
     * Closes the connection to the Redis server
     **/
    stop: function(){
        this.redis.quit();
    }
    
};

/**
 * sha1(str) -> String
 * - str (String): String to be hashed
 * 
 * Chreates a SHA1 hash out of a string
 **/
function sha1(str){
    var hash = crypto.createHash('sha1');
    hash.update(str);
    return hash.digest("hex").toLowerCase();
}