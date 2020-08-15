/**
 * @license MIT, imicros.de (c) 2018 Andreas Leinen
 */
"use strict";

const Redis = require("ioredis");
const _ = require("lodash");
const crypto = require("crypto");
const uuid = require("uuid/v4");

/** Actions */
// action getOek { id } => { id, key }

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
                        let err = new Error("not existing key id requested");
                        this.logger.error("not existing key id requested", err.message);
                        throw err;
                    }
                } catch (err) {
                    /* istanbul ignore next */
                    this.logger.error("Redis error", err.message);
                    throw new Error("failed to read value");
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
        owners: {
            async handler(ctx) {
                let owner = _.get(ctx.meta,"acl.service",null);
                if (owner !== "admin") throw new Error("access not authorized");
                
                let value;
                try {
                    value = await this.client.smembers("owners");
                } catch (err) {
                    console.log(err);
                }
                return value;
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
            this.masterKey = await this.broker.call(this.settings.master + ".getMasterKey",params);
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