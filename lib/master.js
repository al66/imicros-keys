/**
 * @license MIT, imicros.de (c) 2018 Andreas Leinen
 */
"use strict";

const Keys = require("./keys.js");
const crypto = require("crypto");
const secrets = require("secret-sharing.js");
const fs = require("fs");

/** Actions */
// action unseal { id } => { id, key }

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
         * @param {String} token - initial token
         * 
         * @returns {Object} root token + shares 
         */
        init: {
            params: {
                token: { type: "string" }
            },
            async handler(ctx) {
                if (ctx.params.token !== this.initialToken) throw new Error("invalid token");

                if (fs.existsSync("init.conf")) {
                    throw new Error("this method can only be called once");
                }
                
                // create a new root token
                this.token = crypto.randomBytes(32).toString("hex");
                
                // generate a 512-bit key
                let key = secrets.random(512); // => key is a hex string
                
                // split into 5 shares with a threshold of 3
                let shares = secrets.share(key, 5, 3);      
                
                // avoid second call
                await fs.writeFileSync("init.conf",JSON.stringify({ date: Date.now() }));
                this.logger.info("init called");
                
                return {
                    token: this.token,
                    shares: shares
                };
            }
        },
        
        unseal: {
            params: {
                token: { type: "string" },
                share: { type: "string" }
            },
            async handler(ctx) {
                if (ctx.params.token !== this.token) {
                    this.logger.warn("security warning: access with unvalid token", { token: ctx.params.token });
                    throw new Error("unvalid token");
                }
                    
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

        getMasterKey: {
            params: {
                token: { type: "string" }
            },
            handler(ctx) {
                if (ctx.params.token !== this.token) throw new Error("invalid token");
                this.logger.info("Master key requested", { token: ctx.params.token });
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
        async unseal(ctx) {
            // create one time token for keys service
            this.token = crypto.randomBytes(32).toString("hex");
            // create keys service
            await ctx.broker.createService(Keys,Object.assign({ 
                settings: Object.assign(this.settings, { master: this.name, token: this.token })
            }));
            this.logger.info("Keys service created");
        }
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        
        // only used once to call init method
        this.initialToken = process.env.MASTER_TOKEN;
        
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