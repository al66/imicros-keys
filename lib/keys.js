/**
 * @license MIT, imicros.de (c) 2018 Andreas Leinen
 */
"use strict";

const Redis = require("ioredis");
const _ = require("lodash");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");

/** Actions */
// getOek { service, id } => { id, key }
// owners => [ owner id's ]

module.exports = {
    name: "keys",
    
    /**
     * Service settings
     */
    settings: {
        /*
        expirationDays: 30,                     // key expires after 30 days
        redis: {
            port: process.env.REDIS_PORT || 6379,
            host: process.env.REDIS_HOST || "127.0.0.1",
            password: process.env.REDIS_AUTH || "",
            db: process.env.REDIS_DB || 0,
        }
        */        
    },
    $secureSettings: ["redis.password","token"],

    /**
     * Service metadata
     */
    metadata: {},

    /**
     * Service dependencies
     */
    //dependencies: ["master"],	

    /**
     * Actions
     */
    actions: {

        /**
         * get owner encryption key
         * 
         * @actions
         * @param {String} key
         * 
         * @returns {Object} Decoded payload 
         */
        getOek: {
            visibility: "public",                   // should not be available via gateway
            params: {
                service: { type: "string" },
                id: { type: "string", optional: true }
            },
            async handler(ctx) {
                let owner = _.get(ctx.meta,"acl.ownerId",null);
                if (!owner) throw new Error("access not authorized");

                // build key for owner/service
                let key = this.encodeKey({ key: ctx.params.service, owner: owner });
                
                // read given id or default
                try {
                    let id = ctx.params.id || "default";
                    let encoded = await this.client.hget(key,id);
                    if (encoded) {
                        let value = this.decodeValue({ encoded: encoded });
                        // default key expired ?
                        if (ctx.params.id || value.exp > Date.now()) {
                            let result = { 
                                id: value.guid,
                                key: this.hash(value.key, owner)    // hashed with master key
                            };
                            return result; 
                        }
                    } else if (ctx.params.id) {
                        throw new Error("failed to retrieve key");
                    }
                } catch (err) {
                    throw new Error("failed to retrieve key");
                }
                
                // create a new default key
                let def = {
                    guid: uuid(),
                    key: crypto.randomBytes(32).toString("hex"),
                    iat: Date.now(),
                    exp: Date.now() + ( 1000 * 60 * 60 * 24 * this.expirationDays )
                };
                try {
                    let value = this.encodeValue({ value: def });
                    // add owner to owner list
                    await this.client.sadd("owners",owner);                
                    // add service to users list
                    await this.client.sadd(owner,ctx.params.service);                
                    // add new key to index
                    await this.client.hmset(key,def.guid, value, "default", value);
                    
                    // return new default key
                    let result = {
                        id: def.guid,
                        key: this.hash(def.key, owner)          // hashed with master key
                    };
                    return result;
                } catch (err) {
                    /* istanbul ignore next */
                    this.logger.error("Redis error", err.message);
                    throw new Error("failed to write new key");
                }
            }
        },

        /**
         * get all owners
         * 
         * @actions
         * 
         * @returns {Array} owners 
         */
        getOwners: {
            acl: "core",
            async handler(/*ctx*/) {
                let value;
                try {
                    value = await this.client.smembers("owners");
                } catch (err) {
                    console.log(err);
                }
                return value;
            }
        },

        /**
         * delete owner and all his keys
         * 
         * @actions
         * 
         * @param {String} owner
         *
         * @returns {object} { backup } 
         */
        deleteOwner: {
            acl: "core",
            params: {
                owner: { type: "string" }
            },
            async handler(ctx) {
                let backup = {};
                backup[ctx.params.owner] = {
                    owner: ctx.params.owner,
                    services: null,
                    keys: {}
                };
                try {
                    // get services with stored keys
                    let services = await this.client.smembers(ctx.params.owner);
                    backup[ctx.params.owner].services = services;
                    if (services && Array.isArray(services)) {
                        services.map(async (service) => {
                            // build key for owner/service
                            let key = this.encodeKey({ key: service, owner: ctx.params.owner });
                            
                            // get values and delete the key
                            backup[ctx.params.owner].keys[service] = await this.client.hgetall(key);
                            await this.client.del(key);
                        });
                    }
                    // delete the owner key
                    await this.client.del(ctx.params.owner); 

                    // remove owner from owner list
                    await this.client.srem("owners",ctx.params.owner);                

                } catch (err) {
                    console.log(err);
                }
                return { backup };
            }
        }

    },

    /**
     * Events
     */
    events: {},

    /**
     * Methods
     */
    methods: {

        /*  very bad performance...
        hash (key, owner) {
            return crypto.pbkdf2Sync(this.masterKey, owner, 10000, 32, "md5").toString("hex");  
        },
        */
        
        hash (key, owner) {
            return crypto.createHmac("sha256", this.masterKey+owner)
                .update(key)
                .digest("hex");
        },
        
        encodeKey ({ key, owner}) {
            return Buffer.from(owner + "~" + key).toString("base64");
        },
        
        encodeValue ({value}) {
            return Buffer.from(JSON.stringify(value)).toString("base64");
        },
        
        decodeValue ({encoded}) {
            return JSON.parse(Buffer.from(encoded, "base64").toString("ascii"));
        },
        
        connect () {
            return new Promise((resolve, reject) => {
                /* istanbul ignore else */
                let redisOptions = this.settings.redis || {};   // w/o settings the client uses defaults: 127.0.0.1:6379
                this.client = new Redis(redisOptions);

                this.client.on("connect", (() => {
                    this.connected = true;
                    this.logger.info("Connected to Redis");
                    resolve();
                }).bind(this));

                this.client.on("close", (() => {
                    this.connected = false;
                    this.logger.info("Disconnected from Redis");
                }).bind(this));

                this.client.on("error", ((err) => {
                    this.logger.error("Redis redis error", err.message);
                    /* istanbul ignore else */
                    if (!this.connected) reject(err);
                }).bind(this));
            });
        },        
        
        async disconnect () {
            return new Promise((resolve) => {
                /* istanbul ignore else */
                if (this.client && this.connected) {
                    this.client.on("close", () => {
                        resolve();
                    });
                    this.client.disconnect();
                } else {
                    resolve();
                }
            });
        }
        
    },

    /**
     * Service created lifecycle event handler
     */
    async created() {

        // expiration days
        this.expirationDays = _.get(this.settings, "expirationDays", 30);
        // minimum 1 day
        if ( this.expirationDays < 1 ) this.expirationDays = 30; 
        
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {

        // set master key
        if (this.settings.master) {
            // retrieve master key from master - recommended
            let params = {
                token: this.settings.token
            };
            let options = {
                nodeID: this.settings.masterNode
            };
            this.masterKey = await this.broker.call(this.settings.master + ".getMasterKey",params,options);
        } else {
            // retrieve master key from environment variable
            this.masterKey = process.env.MASTER_KEY;
        }
        /* istanbul ignore next */
        if (!this.masterKey) {
            let err = new Error("please set the master key for service " + this.name);
            this.logger.error(err.message);
            throw err;
        }        
        
        // connect to redis db
        await this.connect();
        
    },

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {
        
        // disconnect from redis db
        await this.disconnect();
        
    }
    
};