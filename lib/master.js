/**
 * @license MIT, imicros.de (c) 2018 Andreas Leinen
 *
 */
"use strict";

const Keys = require("./keys.js");
const Cassandra = require("cassandra-driver");
const crypto = require("crypto");
const secrets = require("secrets.js-grempe");
const jwt = require("jsonwebtoken");

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
    $secureSettings: ["cassandra.user","cassandra.password"],

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

                let check = await this.checkKeys();
                if (!check) throw new Error("this method can only be called once"); 
                check = await this.checkHashes();
                if (!check) throw new Error("this method can only be called once"); 

                // generate a 512-bit key
                let key = secrets.random(512); // => key is a hex string

                // split into 5 shares with a threshold of 3
                let shares = secrets.share(key, 5, 3);      
                let hashed = shares.map((value) => crypto.createHash("sha256")
                    .update(value)
                    .digest("hex"));
                
                // avoid second call and save hashes
                await this.storeHashes(hashed);
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
                    let hashed = await this.readHashes() || [];
                    hashed[ctx.params.index] = hash;
                    await this.storeHashes(hashed);
                } catch (err) {
                    this.logger.error("Failed to read hashes", err);
                    throw new Error("Failed to read hashes");
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
                let test = this.encrypt(crypto.randomBytes(32).toString("hex")); // encrypt unvalid key
                try {
                    hashed = await this.readHashes() || [];
                } catch (err) {
                    this.logger.error("Failed to read hashes", err);
                    throw new Error("Failed to read hashes");
                }
                if (hashed.indexOf(hash) < 0) {
                    this.logger.warning("call to getToken with unvalid share", hash);
                } else {
                    test = this.encrypt(this.masterToken);  // encrypt valid key
                }
                
                let token = this.signedJWT({ type: "keys_token", share: hash, test });
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
                    hashed = await this.readHashes() || [];
                } catch (err) {
                    this.logger.error("Failed to read hashes", err);
                    throw new Error("Failed to read hashes");
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
         * verify token
         * 
         * @actions
         * 
         * @param {String} token - retrieved token from action getToken
         * 
         * @returns { valid: true | false } 
         */
        verify: {
            params: {
                token: { type: "string" }
            },
            async handler(ctx) {
                try {
                    jwt.verify(ctx.params.token, this.masterToken);
                    return { valid: true };
                } catch(err) {
                    return { valid: false };
                }
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
                if (decoded.type !== "keys_token" || !decoded.share || !decoded.test ) throw new Error("token not valid");

                let check = this.decrypt(decoded.test);
                if (check !== this.masterToken ) return { sealed: [] };


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
                return { sealed };
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
         
        encrypt (value = ".") {
            try {
                let iv = crypto.randomBytes(this.encryption.ivlen);
                let key = crypto.pbkdf2Sync(this.masterToken, iv, this.encryption.iterations, this.encryption.keylen, this.encryption.digest);
                let cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
                let encrypted = cipher.update(value, "utf8", "hex");
                encrypted += cipher.final("hex");
                return iv.toString("hex") + "~" + encrypted;
            } catch (err) {
                this.logger.warn("encryption failed", err);
                return ".~.";
            }
        },

        decrypt (encrypted) {
            try {
                let parts = encrypted.split("~");
                let iv = Buffer.from(parts[0], "hex");
                let key = crypto.pbkdf2Sync(this.masterToken, iv, this.encryption.iterations, this.encryption.keylen, this.encryption.digest);
                let decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
                let decrypted = decipher.update(parts[1], "hex", "utf8");
                decrypted += decipher.final("utf8");
                return decrypted;            
            } catch (err) {
                this.logger.warn("decryption failed", err);
                return "unvalid";
            }
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
        },

        async storeHashes(hashes) {
            let query = `UPDATE ${this.keyspace}.${this.hashTable} SET hashes = :hashes WHERE id = 1;`;
            let params = { 
                hashes            };
            try {
                await this.cassandra.execute(query, params, {prepare: true});
            } catch (err) /* istanbul ignore next */ {
                this.logger.error("Cassandra insert error", { error: err.message, query: query, params: params });
                throw new Error("failed to write hashes");
            }
        },

        async readHashes() {
            let query = `SELECT hashes FROM ${this.keyspace}.${this.hashTable} WHERE id = 1;`;
            let params = { };
            try {
                let result = await this.cassandra.execute(query, params, {prepare: true});
                let row = result.first();
                if (row) {
                    let hashes = row.get("hashes");            
                    return hashes;
                }
                return null;
            } catch (err) /* istanbul ignore next */ {
                this.logger.error("Cassandra query error", { error: err.message, query: query, params: params });
                return null;
            }
        },

        async checkKeys() {
            let query = `SELECT owner FROM ${this.keyspace}.${this.keyTable} LIMIT 1;`;
            let params = { };
            try {
                let result = await this.cassandra.execute(query, params, {prepare: true});
                let row = result.first();
                let owner = row.get("owner");
                if (owner) return false;
                return true;
            } catch (err) {
                return true;
            }
        },

        async checkHashes() {
            let query = `SELECT hashes FROM ${this.keyspace}.${this.hashTable} WHERE id = 1;`;
            let params = { };
            try {
                let result = await this.cassandra.execute(query, params, {prepare: true});
                let row = result.first();
                if (row) return false;
                return true;
            } catch (err) /* istanbul ignore next */ {
                this.logger.error("Cassandra query error", { error: err.message, query: query, params: params });
                return false;
            }
        },

        async connect () {

            // connect to cassandra cluster
            await this.cassandra.connect();
            this.logger.info("Connected to cassandra", { contactPoints: this.contactPoints, datacenter: this.datacenter, keyspace: this.keyspace });
            
            // create tables, if not exists
            let query = `CREATE TABLE IF NOT EXISTS ${this.keyspace}.${this.hashTable} `;
            query += " ( id int, hashes frozen<list<text>>, PRIMARY KEY (id) ) ";
            query += " WITH comment = 'storing hashes';";
            await this.cassandra.execute(query);

        },
        
        async disconnect () {

            // close all open connections to cassandra
            await this.cassandra.shutdown();
            this.logger.info("Disconnected from cassandra", { contactPoints: this.contactPoints, datacenter: this.datacenter, keyspace: this.keyspace });
            
        }  
            
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        
        // only used once to call init method
        this.masterToken = process.env.MASTER_TOKEN;

        // encryption setup
        this.encryption = {
            iterations: 1000,
            ivlen: 16,
            keylen: 32,
            digest: "sha512"
        };

        // cassandra setup
        this.contactPoints = ( this.settings?.cassandra?.contactPoints ?? "127.0.0.1" ).split(",");
        this.datacenter = this.settings?.cassandra?.datacenter ?? "datacenter1";
        this.keyspace = this.settings?.cassandra?.keyspace ?? "imicros_keys";
        this.keyTable = this.settings?.cassandra?.keyTable ?? "keys";
        this.hashTable = this.settings?.cassandra?.hashTable ?? "hashes";
        this.config = {
            contactPoints: this.contactPoints, 
            localDataCenter: this.datacenter, 
            keyspace: this.keyspace, 
            protocolOptions: { 
                port: this.settings?.cassandra?.port ?? (process.env.CASSANDRA_PORT || 9042 )
            },
            credentials: { 
                username: this.settings?.cassandra?.user ?? (process.env.CASSANDRA_USER || "cassandra"), 
                password: this.settings?.cassandra?.password ?? (process.env.CASSANDRA_PASSWORD || "cassandra") 
            }
        };
        this.cassandra = new Cassandra.Client(this.config);
        
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {

        // connect to cassandra cluster
        await this.connect();
        
    },

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {

        // disconnect from cassandra cluster
        await this.disconnect();

    }
    
};