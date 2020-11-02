/**
 * @license MIT, imicros.de (c) 2018 Andreas Leinen
 *
 * source hash/verify functionality: https://gist.github.com/skeggse/52672ddee97c8efec269
 *
 */
"use strict";

const Keys = require("./keys.js");
const crypto = require("crypto");
const secrets = require("secrets.js-grempe");
const fs = require("fs");

/** Actions */
// init { token } => { shares, verifyHash } 
// setVerifyHash { nodeID, token, verifyHash } => { verifyHash } 
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
        redis: {
            port: process.env.REDIS_PORT || 6379,
            host: process.env.REDIS_HOST || "127.0.0.1",
            password: process.env.REDIS_AUTH || "",
            db: process.env.REDIS_DB || 0,
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
         * @returns {Object} { shares, verifyHash } 
         */
        init: {
            acl: "core",
            params: {
                token: { type: "string" }
            },
            async handler(ctx) {
                if (ctx.params.token !== this.masterToken) throw new Error("invalid token");

                if (fs.existsSync("init.conf")) {
                    throw new Error("this method can only be called once");
                }
                
                // generate a 512-bit key
                let key = secrets.random(512); // => key is a hex string

                // create hash
                let combined = await this.hashKey(key);
                
                // split into 5 shares with a threshold of 3
                let shares = secrets.share(key, 5, 3);      
                
                // avoid second call
                await fs.writeFileSync("init.conf",JSON.stringify({ date: Date.now() }));
                this.logger.info("init called");
                
                return {
                    shares: shares,
                    verifyHash: combined
                };
            }
        },
        
        /**
         * get verify hash
         * 
         * @actions
         *
         * @param {String} token - master token
         * @param {Array<String>} shares - array of minimum required shares
         * 
         * @returns {String} { verifyHash } 
         */
        getVerifyHash: {
            acl: "core",
            params: {
                token: { type: "string" },
                shares: { type: "array", items: "string" }
            },
            async handler(ctx) {
                if (ctx.params.token !== this.masterToken) throw new Error("invalid token");

                // reconstruct master key
                let key = secrets.combine(ctx.params.shares);

                // create hash
                let combined = await this.hashKey(key);
                
                return {
                    verifyHash: combined
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
                
                return {
                    share: newShare
                };
            }
        },
        
        /**
         * set the verification hash
         * 
         * @actions
         *
         * @param {String} nodeID
         * @param {String} token - master token
         * @param {String} verifyHash - combined hash/salt
         * 
         * @returns {Object} { verifyHash } 
         */
        setVerifyHash: {
            acl: "core",
            params: {
                nodeID: { type: "string" },
                token: { type: "string" },
                verifyHash: { type: "string" }
            },
            async handler(ctx) {
                // pass through
                if (ctx.params.nodeID !== this.broker.nodeID) return this.broker.call(this.name + ".setVerifyHash", ctx.params, { nodeID: ctx.params.nodeID });
                
                if (ctx.params.token !== this.masterToken) throw new Error("invalid token");
                if (this.masterKey) throw new Error("master is already unsealed");
                
                this.verifyHash = Buffer.from(ctx.params.verifyHash,"hex");
                
                return {
                    verifyHash: ctx.params.verifyHash
                };
            }
        },
      
        /**
         * commit share for unsealing 
         * 
         * @actions
         *
         * @param {String} nodeID
         * @param {String} token - master token
         * @param {String} share
         * 
         * @returns {Object} { received } 
         */
        unseal: {
            params: {
                nodeID: { type: "string" },
                token: { type: "string" },
                share: { type: "string" }
            },
            async handler(ctx) {
                // pass through
                if (ctx.params.nodeID !== this.broker.nodeID) return this.broker.call(this.name + ".unseal", ctx.params, { nodeID: ctx.params.nodeID });

                if (ctx.params.token !== this.masterToken) throw new Error("invalid token");
                if (this.masterKey) throw new Error("master is already unsealed");
                
                if (this.config.verify && !this.verifyHash) throw new Error("Missing hash for verifying key. Use setVerifyHash first!");
                
                let components = secrets.extractShareComponents(ctx.params.share);
                if (!components.id) throw new Error("unvalid share");

                if (!this.shares) this.shares = new Set();
                this.shares.add(ctx.params.share);
                
                if (this.shares.size >= 3) {
                    this.masterKey = secrets.combine(Array.from(this.shares));
                    
                    // verify key
                    if (this.config.verify) {
                        let result = await this.verifyKey(this.masterKey);
                        if (!result) throw new Error("Wrong key - verification failed! Please check your shares and/or the verification key");
                    }
                    
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
         * @param {String} token - master token
         * 
         * @returns {Object} { sealed } - array nodeID's of sealed nodes
         */
        getSealed: {
            acl: "core",
            params: {
                token: { type: "string" }
            },
            async handler(ctx) {
                if (ctx.params.token !== this.masterToken) throw new Error("invalid token");
                
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
        },
      
        /**
         * hashKey  
         * 
         * @methods
         *
         * @param {String} key
         * 
         * @returns {String} verifyHash
         */
        async hashKey (key) {
            try {
                let salt = crypto.randomBytes(this.config.saltBytes);
                let hash = crypto.pbkdf2Sync(key, salt, this.config.iterations, this.config.hashBytes, this.config.digest);
                let combined = Buffer.alloc(hash.length + salt.length + 8);
                // include the size of the salt so that we can, during verification,
                // figure out how much of the hash is salt
                combined.writeUInt32BE(salt.length, 0, true);
                // similarly, include the iteration count
                combined.writeUInt32BE(this.config.iterations, 4, true);
                salt.copy(combined, 8);
                hash.copy(combined, salt.length + 8);
                let combinedStr = combined.toString("hex");
                return combinedStr;
            } catch (err) {
                /* istanbul ignore next */
                throw new Error("Failed to create hash");
            }
        },
      
        /**
         * verifyKey  
         * 
         * @methods
         *
         * @param {String} key
         * 
         * @returns {Boolean} true|false
         */
        async verifyKey (key) {
            try {
                // extract the salt and hash from the combined buffer
                let saltBytes = this.verifyHash.readUInt32BE(0);
                let hashBytes = this.verifyHash.length - saltBytes - 8;
                let iterations = this.verifyHash.readUInt32BE(4);
                let salt = this.verifyHash.slice(8, saltBytes + 8);
                let hash = this.verifyHash.toString("binary", saltBytes + 8);

                // verify the salt and hash against the password
                let verify = crypto.pbkdf2Sync(key, salt, iterations, hashBytes, this.config.digest);
                
                return (verify.toString("binary") === hash);
            } catch (err) /* istanbul ignore next */ {
                this.logger.warn("Error occured during verification of key", err);
                return false;
            }
        }
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        
        // only used once to call init method
        this.masterToken = process.env.MASTER_TOKEN;
        // used to verify result of master key, can be also set via setVerifyHash
        this.verifyHash = process.env.MASTER_HASH;
        // config
        this.config = {
            // verify key
            verify: true,
            // size of the generated hash
            hashBytes: 32,
            // larger salt means hashed passwords are more resistant to rainbow table, but
            // you get diminishing returns pretty fast
            saltBytes: 16,
            // more iterations means an attacker has to take longer to brute force an
            // individual password, so larger is better. however, larger also means longer
            // to hash the password.
            iterations: 100000,
            // algorithm
            digest: "sha512"
        };
        
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