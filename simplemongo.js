exports.SimpleMongo = SimpleMongo;
exports.StreamWriter = StreamWriter;
exports.StreamReader = StreamReader;

var mongo = require('../node-mongodb-native/lib/mongodb'),
    EventEmitter = require('events').EventEmitter,
    sys = require("sys");

function SimpleMongo(db_name){
    this.db_name = db_name || "default";
    this.db_connection = false
    this.create_db();
}

SimpleMongo.prototype.create_db = function(callback){
    var db = new mongo.Db(this.db_name, new mongo.Server("localhost", mongo.Connection.DEFAULT_PORT, {auto_reconnect: true}), {});
    db.open((function(err, db){
        if(!err && !!db){
            this.db_connection = db;
            console.log("db opened")
            if(callback && typeof callback=="function"){
                callback()
            }
        }else
            console.log("db failed miserably :S")
    }).bind(this));
    console.log("db initiated")
}


SimpleMongo.prototype.list = function(onsuccess, onerror){
    if(!this.db_connection){
        this.create_db((function(){this.list(onsuccess, onerror)}).bind(this));
        return;
    }
    
    this.db_connection.collectionNames((function(err, collections){
        var collection_names = [], n, i;
        
        if(!!err || !collections){
            if(onerror && typeof onerror == "function"){
                return onerror(err);
            }
        }
        
        for(i=0; i<collections.length;i++){
            n = collections[i].name.substr(this.db_name.length+1);
            if(n.substr(0,6)!="system")
                collection_names.push(n);
        }
        collection_names.sort();
        
        if(onsuccess && typeof onsuccess == "function"){
            onsuccess(collection_names);
        }
    }).bind(this));
}

SimpleMongo.prototype.collection = function(coll_name, onsuccess, onerror){
    if(!this.db_connection){
        this.create_db((function(){this.collection(coll_name, onsuccess, onerror)}).bind(this));
        return;
    }
    this.db_connection.createCollection(coll_name, function(err, collection){
        if(!!err || !collection){
            if(onerror && typeof onerror == "function"){
                onerror(err);
            }
        }else if(onsuccess && typeof onsuccess == "function"){
            onsuccess(collection);
        }
    });
}

SimpleMongo.prototype.clear = function(coll_name, onsuccess, onerror){
    this.db_connection.dropCollection(coll_name, (function(err, result){
        if(err || !result){
            if(typeof onerror=="function")
                onerror(err);
        }
        else{
            if(typeof onsuccess=="function")
                onsuccess(result);
        }
    }).bind(this), onerror);
}

SimpleMongo.prototype.insert = function(coll_name, doc, onsuccess, onerror){
    this.collection(coll_name,(function(collection){
        collection.insert(doc, function(err, doc){
            if(err){
                if(typeof onerror=="function")
                    onerror(err);
            }
            else{
                if(typeof onsuccess=="function")
                    onsuccess(doc);
            }
        });
    }).bind(this), onerror);
}

SimpleMongo.prototype.find = function(coll_name, doc, params, count, onsuccess, onerror){
    doc = doc || {};
    params = params || {};
    count = !!count;
    
    this.collection(coll_name,(function(collection){
        collection.find(doc, params,(function(err, cursor) {
            if(!!err || !cursor){
                if(typeof onerror=="function")
                    onerror(err);
            }else{
                if(!count){
                    if(typeof onsuccess=="function")
                        onsuccess(cursor);
                }else{
                    collection.count(function(err, count){
                        if(!!err){
                            if(typeof onerror=="function")
                                onerror(err);
                        }else{
                            if(typeof onsuccess=="function")
                                onsuccess(cursor, count);
                        }
                    });
                }
            }
        }).bind(this));
    }).bind(this), onerror);
}

SimpleMongo.prototype.remove = function(coll_name, id, onsuccess, onerror){
    id = id || (typeof id=="object" && "_id" in id && id._id);
    if(!id){
        if(typeof onerror=="function"){
            onerror("Invalid ID");
        }
    }
    this.collection(coll_name,(function(collection){
        collection.remove({_id: new mongo.ObjectID(id)}, function(err, collection){
            if(!!err || !collection){
                if(typeof onerror=="function")
                    onerror(err);
            }else{
                if(typeof onsuccess=="function")
                    onsuccess(collection);
            }
        })
    }).bind(this), onerror);
}

SimpleMongo.prototype.update = function(coll_name, criteria, doc, onsuccess, onerror){
    
    if(!doc || !criteria || !(criteria._id || doc._id)){
        if(typeof onerror=="function"){
            onerror("Invalid object "+JSON.stringify(criteria)+"; "+JSON.stringify(doc));
        }
    }
    
    criteria = criteria || {};
    if(!criteria._id)
        criteria._id = doc._id;
    
    if(typeof criteria._id == "string")
        criteria._id = new mongo.ObjectID(criteria._id);
    
    if(typeof doc._id == "string")
        doc._id = new mongo.ObjectID(doc._id);

    this.collection(coll_name,(function(collection){
        collection.update(criteria, doc, (function(err, doc){
            if(!!err || !doc){
                if(typeof onerror=="function")
                    onerror(err);
            }else{
                if(typeof onsuccess=="function")
                    onsuccess(doc);
            }
        }).bind(this));
    }).bind(this), onerror);
}


SimpleMongo.prototype.gridFsOpen = function(filename, mode, options, onsuccess, onerror){
    if(!this.db_connection){
        this.create_db((function(){this.gridFsOpen(filename, mode, options, onsuccess, onerror)}).bind(this));
        return;
    }
    mode = mode || "r";
    var gridStore = new mongo.GridStore(this.db_connection, filename, mode, options);
    gridStore.open(function(err, gridStore) {
        if(!!err || !gridStore){
            if(typeof onerror=="function")
                onerror(err);
            return;
        }
        if(typeof onsuccess=="function")
            onsuccess(gridStore);
    });
}


function StreamWriter(simplemongo, filename, options){
    EventEmitter.call(this);
    
    this.simplemongo = simplemongo;
    this.filename = filename;
    this.running = true;
    this.options = options;
    
    this.queue = [];
    this.queueEnd = false;
    
    this.init();
}
sys.inherits(StreamWriter, EventEmitter);

StreamWriter.prototype.init = function(){
    this.simplemongo.gridFsOpen(this.filename,"w", this.options, (function(gs){
        this.gs = gs;
        
        this.emit("opened", gs);
        
        var data; 
        while(this.queue.length){
            this.writeFile(this.queue.shift());
        }
        if(this.queueEnd){
            this.end();
        }
        
    }).bind(this), this.onError.bind(this));
}

StreamWriter.prototype.feed = function(data){
    if(this.gs)
        this.writeFile(data);
    else
        this.queue.push(data);
}

StreamWriter.prototype.writeFile = function(data){
    
    this.gs.write(data, (function(err, result){
    console.log(1)
        if(!!err && !result){
            this.onError(err);
            return;
        }
        
    }).bind(this));
}

StreamWriter.prototype.end = function(){
    if(this.gs){
        this.gs.close((function(err,result){
            if(!!err && !result){
                this.onError(err);
                return;
            }
            this.emit("end", this.gs);
        }).bind(this));
    }else
        this.queueEnd = true;
}

StreamWriter.prototype.onError = function(err){
    this.emit("error", err);
}

function StreamReader(simplemongo, filename, chunksize){
    EventEmitter.call(this);
    
    this.simplemongo = simplemongo;
    this.chunksize = chunksize || 10240;
    this.filename = filename;
    this.running = true;
    
    this.init();
}
sys.inherits(StreamReader, EventEmitter);

StreamReader.prototype.init = function(){
    this.simplemongo.gridFsOpen(this.filename,"r",{}, (function(gs){
        this.gs = gs;
        this.emit("opened", gs);
        this.readFile(this.gs.length);
    }).bind(this), this.onError.bind(this));
}

StreamReader.prototype.stop = function(){
    this.running = false;
}

StreamReader.prototype.readFile = function(size){
    if(!this.running) return;
    
    this.gs.read(this.chunksize < size? this.chunksize : size, null, (function(err, result){
        if(!this.running) return;
    
        if(!!err && !result){
            this.onError(err);
            return;
        }
        
        this.onData(new Buffer(result,"binary"));

        size -= this.chunksize;
        
        if(size>0){
            this.readFile(size);
        }else{
            this.onEnd();
        }
    }).bind(this));
}


StreamReader.prototype.onData = function(data){
    this.emit("data", data);
}

StreamReader.prototype.onError = function(err){
    this.emit("error", err);
}

StreamReader.prototype.onEnd = function(){
    this.emit("end");
}
