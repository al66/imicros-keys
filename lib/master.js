/**
 * @license MIT, imicros.de (c) 2018 Andreas Leinen
 *
 */
"use strict";

const Keys = require("./keys.js");
const crypto = require("crypto");
const secrets = require("secrets.js-grempe");
const jwt = require("jsonwebtoken");
const fs = require("fs");

/** Actions */
// init { token } => { shares } 
// getToken { share } => { token }
// unseal { nodeID, token, share } => { received }
// isSealed => true|false
// getSealed { token } => { sealed:Array<String> }
// getMasterKey { token } => masterKey  - only local calls!

module.exports = {
    name: "master",
    
    /**
     * Service settings
     */
    settings: {
        /*
        expirationDays: 30,                     // key expires after 30 days
        cassandra: {
            contactPoints: process.env.CASSANDRA_CONTACTPOINTS || "127.0.0.1", 
            datacenter: process.env.CASSANDRA_DATACENTER || "datacenter1", 
            keyspace: process.env.CASSANDRA_KEYSPACE || "imicros_flow" 
        }
        */        
    },
    $secureSettings: ["redis.password"],

    /**
     * Service metadata
     */
    metadata: {},

    /**
     * Service dependencies
     */
    //dependencies: [],	

    /**
     * Actions
     */
    actions: {

        /**
         * init
         * 
         * @actions
         *
         * @param {String} token - master token
         * 
         * @returns {Object} { shares } 
         */
        init: {
            params: {
                token: { type: "string" }
            },
            async handler(ctx) {
                if (this.masterKey) throw new Error("master is already unsealed");

                if (ctx.params.token !== this.masterToken) throw new Error("invalid token");

                if (fs.existsSync("init.conf")) {
                    throw new Error("this method can only be called once");
                }
                
                // generate a 512-bit key
                let key = secrets.random(512); // => key is a hex string

                // split into 5 shares with a threshold of 3
                let shares = secrets.share(key, 5, 3);      
                let hashed = shares.map((value) => crypto.createHash("sha256")
                    .update(value)
                    .digest("hex"));
                
                // avoid second call and save hashes
                await fs.writeFileSync("init.conf",JSON.stringify({ date: Date.now(), hashed }));
                this.logger.info("init called");
                
                return {
                    shares: shares
                };
            }
        },
        
        /**
         * new share
         * 
         * @actions
         *
         * @param {String} token - master token
         * @param {Number} index - index of share to create
         * @param {Array<String>} shares - array of minimum required shares
         * 
         * @returns {String} { share } 
         */
        newShare: {
            acl: "core",
            params: {
                token: { type: "string" },
                index: { type: "number" },
                shares: { type: "array", items: "string" }
            },
            async handler(ctx) {
                if (ctx.params.token !== this.masterToken) throw new Error("invalid token");

                // create new share
                let newShare = secrets.newShare( ctx.params.index, ctx.params.shares );
                let hash = crypto.createHash("sha256")
                    .update(newShare)
                    .digest("hex");

                // update init.conf file
                try {
                    let conf = JSON.parse(fs.readFileSync("init.conf"));
                    if (!conf.hashed || !Array.isArray(conf.hashed)) throw new Error("Failed to read conf file");                    
                    conf.hashed[ctx.params.index] = hash;
                    await fs.writeFileSync("init.conf",JSON.stringify({ date: Date.now(), hashed: conf.hashed }));
                } catch (err) {
                    this.logger.error("Failed to read conf file", err);
                    throw new Error("Failed to read conf file");
                }
                
                return {
                    share: newShare
                };
            }
        },
        
        getToken: {
            params: {
                share: { type: "string" }
            },
            async handler(ctx) {

                let hash = crypto.createHash("sha256")
                    .update(ctx.params.share)
                    .digest("hex");
                let hashed = [];
                try {
                    let conf = JSON.parse(fs.readFileSync("init.conf"));
                    if (!conf.hashed || !Array.isArray(conf.hashed)) throw new Error("Failed to read conf file");                    
                    hashed = conf.hashed;
                } catch (err) {
                    this.logger.error("Failed to read conf file", err);
                    throw new Error("Failed to read conf file");
                }
                if (hashed.indexOf(hash) < 0) {
                    this.logger.warning("call to unseal with unvalid share", hash);
                    throw new Error("Invalid share");
                }
                
                let token = this.signedJWT({ type: "keys_token", share: hash });
                return { token };
            }
        },

        /**
         * commit share for unsealing 
         * 
         * @actions
         *
         * @param {String} nodeID
         * @param {String} share
         * 
         * @returns {Object} { received } 
         */
        unseal: {
            params: {
                nodeID: { type: "string" },
                share: { type: "string" }
            },
            async handler(ctx) {
                // pass through
                if (ctx.params.nodeID !== this.broker.nodeID) return this.broker.call(this.name + ".unseal", ctx.params, { nodeID: ctx.params.nodeID });

                if (this.masterKey) throw new Error("master is already unsealed");

                let hash = crypto.createHash("sha256")
                    .update(ctx.params.share)
                    .digest("hex");
                let hashed = [];
                try {
                    let conf = JSON.parse(fs.readFileSync("init.conf"));
                    if (!conf.hashed || !Array.isArray(conf.hashed)) throw new Error("Failed to read conf file");                    
                    hashed = conf.hashed;
                } catch (err) {
                    this.logger.error("Failed to read conf file", err);
                    throw new Error("Failed to read conf file");
                }
                if (hashed.indexOf(hash) < 0) {
                    this.logger.warn("call to unseal with unvalid share", hash);
                    throw new Error("Invalid share");
                }

                let components = secrets.extractShareComponents(ctx.params.share);
                if (!components.id) throw new Error("unvalid share");

                if (!this.shares) this.shares = new Set();
                this.shares.add(ctx.params.share);
                
                if (this.shares.size >= 3) {
                    this.masterKey = secrets.combine(Array.from(this.shares));
                    
                    // create keys service
                    await this.unseal(ctx);
                }
                return {
                    received: this.shares.size
                };
            }
        },
        
        /**
         * node is sealed
         * 
         * @actions
         * 
         * @returns {Boolean} true | false 
         */
        isSealed: {
            visibility: "public",
            handler(/*ctx*/) {
                return this.masterKey && this.masterKey.length && this.masterKey.length > 0 ? false : true;
            }
        },

        /**
         * get sealed nodes 
         * 
         * @actions
         *
         * @param {String} token - retrieved token from action getToken
         * 
         * @returns {Object} { sealed } - array nodeID's of sealed nodes
         */
        getSealed: {
            params: {
                token: { type: "string" }
            },
            async handler(ctx) {
                let decoded = jwt.verify(ctx.params.token, this.masterToken);
                if (decoded.type !== "keys_token" || !decoded.share) throw new Error("token not valid");

                let sealed = [];
                let unsealed = [];
                let services = await this.broker.call("$node.services", { onlyAvailable: true });
                await Promise.all(services.map(async (service) => {
                    if (service.name === this.name) {
                        let nodes = Array.isArray(service.nodes) ? service.nodes : [];
                        if (nodes.length < 1 && service.nodeID) nodes.push(service.nodeID);
                        await Promise.all(nodes.map(async (node) => {
                            let check = await this.broker.call(this.name + ".isSealed",{},{ nodeID: node });
                            if (check) { 
                                sealed.push(node) ;
                            } else {
                                unsealed.push(node);
                            }
                        }));
                    }
                }));
                return { sealed, unsealed };
            }
        },
        
        /**
         * get master key - only internal/locally! may only be called by keys service during start!  
         * 
         * @actions
         *
         * @param {String} token - one time token
         * 
         * @returns {String} master key
         */
        getMasterKey: {
            visibility: "protected",
            params: {
                token: { type: "string" }
            },
            handler(ctx) {
                if (ctx.params.token !== this.token) throw new Error("invalid token");
                this.logger.info("Master key requested", { token: ctx.params.token });

                // reset token - may be used only once...
                this.token = null;                

                // could not be ... but ensures unvalid return values from keys service
                if (!this.masterKey) throw new Error("Master is still sealed! Wait for unsealing...");
                
                return this.masterKey;
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

        /**
          * Generate a signed JWT token
          * 
          * @param {Object} payload 
          * 
          * @returns {String} Signed token
          */
        signedJWT(payload) {
            let today = new Date();
            let exp = new Date(today);
            exp.setDate(today.getDate() + 60);
            payload.exp = Math.floor(exp.getTime() / 1000);
 
            return jwt.sign(payload, this.masterToken);
        },
         

        /**
         * unseal  
         * 
         * @methods
         *
         * @param {Context} ctx
         * 
         */
        async unseal(ctx) {
            // create one time token for keys service
            this.token = crypto.randomBytes(32).toString("hex");
            // create keys service
            await ctx.broker.createService(Keys,Object.assign({ 
                name: this.settings.nameKeysService || "keys",
                settings: Object.assign(this.settings, { master: this.name, masterNode: this.nodeID, token: this.token })
            }));
            this.logger.info("Keys service created");
        }
            
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        
        // only used once to call init method
        this.masterToken = process.env.MASTER_TOKEN;
        
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {},

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {}
    
};