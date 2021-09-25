/**
 * @license MIT, imicros.de (c) 2018 Andreas Leinen
 */
"use strict";

const Cassandra = require("cassandra-driver");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");

/** Actions */
// getSek { token, service, id } => { id, key }
// getOek { service, id } => { id, key }
// deleteOwner { owner } => bakup: { owner, services }      Admin only!

module.exports = {
    name: "keys",
    
    /**
     * Service settings
     */
    settings: {
        /*
        expirationDays: 30,                     // key expires after 30 days
        cassandra: {
            contactPoints: process.env.CASSANDRA_CONTACTPOINTS || "127.0.0.1", 
            datacenter: process.env.CASSANDRA_DATACENTER || "datacenter1", 
            keyspace: process.env.CASSANDRA_KEYSPACE || "imicros_keys" 
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
         * get service encryption key
         * 
         * @actions
         * @param {String} token
         * @param {String} service
         * @param {String} id 
         * 
         * @returns {Object} { id, key }
         */
        getSek: {
            visibility: "public",                   // should not be available via gateway
            params: {
                token: { type: "string" },
                service: { type: "string" },
                id: { type: "string", optional: true }
            },
            async handler(ctx) {
                if (ctx.params.token !== this.serviceToken) throw new Error("access not authorized");

                let result =  await this.getKey({
                    service: ctx.params.service,
                    owner: ctx.params.service,
                    id: ctx.params.id || null
                });
                return result;
            }
        },

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
                let owner = ctx.meta?.acl?.ownerId ?? null;
                if (!owner) throw new Error("access not authorized");

                let result =  await this.getKey({
                    service: ctx.params.service,
                    owner,
                    id: ctx.params.id || null
                });
                return result;
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
                try {
                    // get services with stored keys
                    let backup = await this.readKeys({ owner: ctx.params.owner });
                    // delete keys 
                    await this.deleteKeys({ owner: ctx.params.owner });
                    return backup;
                } catch (err) {
                    this.logger.error("Failed to delete", { owner:ctx.params.owner, err });
                    throw new Error("Failed to delete");
                }
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
        
        async getKey ({ service, owner, id = null }) {

            // read given id or default
            try {
                let encoded = await this.readKey({ owner, service, id });
                if (encoded) {
                    let value = this.decodeValue({ encoded: encoded });
                    // default key expired ?
                    if (id || value.exp > Date.now()) {
                        let result = { 
                            id: value.guid,
                            key: this.hash(value.key, owner)    // hashed with master key
                        };
                        return result; 
                    }
                } else if (id) {
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
                await this.newKey({ owner, service, id: def.guid, value });
                
                // return new default key
                let result = {
                    id: def.guid,
                    key: this.hash(def.key, owner)          // hashed with master key
                };
                return result;
            } catch (err) {
                /* istanbul ignore next */
                this.logger.error("Cassandra insert error", err.message);
                throw new Error("failed to write new key");
            }

        },

        async readKey({ owner, service, id }) {
            let query = `SELECT owner,keychain FROM ${process.env.CASSANDRA_KEYSPACE}.${this.keyTable} WHERE owner = :owner AND service = :service;`;
            let params = { 
                owner,
                service
            };
            try {
                let result = await this.cassandra.execute(query, params, {prepare: true});
                let row = result.first();
                if (row) {
                    let keychain = row.get("keychain");            
                    if (id) return keychain[id];
                    return keychain["default"];
                }
                return null;
            } catch (err) /* istanbul ignore next */ {
                this.logger.error("Cassandra query error", { error: err.message, query: query, params: params });
                return null;
            }
        },

        async newKey({ owner, service, id, value }) {
            let query = "UPDATE keys SET keychain['default'] = :newKey, keychain[:newId] = :newKey WHERE owner = :owner AND service = :service;";
            let params = { 
                owner,
                service,
                newId: id,
                newKey: value
            };
            try {
                await this.cassandra.execute(query, params, {prepare: true});
            } catch (err) /* istanbul ignore next */ {
                this.logger.error("Cassandra insert error", { error: err.message, query: query, params: params });
                throw new Error("failed to write new key");
            }
        },

        async readKeys({ owner }) {
            if (!owner) return null;

            let query = `SELECT owner,service,keychain FROM ${process.env.CASSANDRA_KEYSPACE}.${this.keyTable} WHERE owner = :owner;`;
            let params = { 
                owner
            };
            try {
                let result = await this.cassandra.execute(query, params, {prepare: true});
                if (result.rows && Array.isArray(result.rows)) {
                    let keys = {
                        owner,
                        services: {}
                    };
                    result.rows.forEach(row => {
                        let service = row.get("service");
                        let keychain = row.get("keychain");
                        keys.services[service] = keychain;
                    });
                    return keys;
                }
                return null;
            } catch (err) /* istanbul ignore next */ {
                this.logger.warn("Cassandra query error", { error: err.message, query: query, params: params });
                return null;
            }
        },

        async deleteKeys({ owner }) {
            if (!owner) return true;

            let query = `DELETE FROM ${process.env.CASSANDRA_KEYSPACE}.${this.keyTable} WHERE owner = :owner;`;
            let params = { 
                owner
            };
            try {
                await this.cassandra.execute(query, params, {prepare: true});
                return true;
            } catch (err) /* istanbul ignore next */ {
                this.logger.warn("Cassandra query error", { error: err.message, query: query, params: params });
                return false;
            }
        },

        async connect () {

            // connect to cassandra cluster
            await this.cassandra.connect();
            this.logger.info("Connected to cassandra", { contactPoints: this.contactPoints, datacenter: this.datacenter, keyspace: this.keyspace });
            
            // validate parameters
            // TODO! pattern doesn't work...
            /*
            let params = {
                keyspace: this.keyspace, 
                tablename: this.contextTable
            };
            let schema = {
                keyspace: { type: "string", trim: true },
                //tablename: { type: "string", trim: true, pattern: "[a-z][a-z0-9]*(_[a-z0-9]+)*", patternFlags: "g" } // doesn't work
                //tablename: { type: "string", trim: true, pattern: /[a-z][a-z0-9]*(_[a-z0-9]+) } // doesn't work
                tablename: { type: "string", trim: true }
            };
            */
            /*
            let valid = await this.broker.validator.validate(params,schema);
            if (!valid) {
                this.logger.error("Validation error", { params: params, schema: schema });
                throw new Error("Unalid table parameters. Cannot init cassandra database.");
            }
            */
            
            // create tables, if not exists
            let query = `CREATE TABLE IF NOT EXISTS ${process.env.CASSANDRA_KEYSPACE}.${this.keyTable} `;
            query += " ( owner varchar, service varchar, keychain map<text, text>, PRIMARY KEY (owner,service) ) ";
            query += " WITH comment = 'storing keys';";
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
    async created() {

        // expiration days
        this.expirationDays = this.settings?.expirationDays ?? 30;
        // minimum 1 day
        if ( this.expirationDays < 1 ) this.expirationDays = 30; 

        this.serviceToken = process.env.SERVICE_TOKEN;
        
        // cassandra setup
        this.contactPoints = ( this.settings?.cassandra?.contactPoints ?? "127.0.0.1" ).split(",");
        this.datacenter = this.settings?.cassandra?.datacenter ?? "datacenter1";
        this.keyspace = this.settings?.cassandra?.keyspace ?? "imicros_keys";
        this.keyTable = this.settings?.cassandra?.keyTable ?? "keys";
        this.cassandra = new Cassandra.Client({ contactPoints: this.contactPoints, localDataCenter: this.datacenter, keyspace: this.keyspace });

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