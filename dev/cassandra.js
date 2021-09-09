
"use strict";

require ("../local.js");

const Cassandra = require("cassandra-driver");
const { v4: uuid } = require("uuid");
const util = require("util");

process.env.CASSANDRA_CONTACTPOINTS = "192.168.2.124";
process.env.CASSANDRA_DATACENTER = "datacenter1";
process.env.CASSANDRA_KEYSPACE = "imicros_keys";

const client = new Cassandra.Client({ contactPoints: ["192.168.2.124"], localDataCenter: process.env.CASSANDRA_DATACENTER, keyspace: process.env.CASSANDRA_KEYSPACE });

async function connect() {
    await client.connect();
}

async function disconnect() {
    await client.shutdown();
}

async function createTable() {

    let query = `CREATE TABLE IF NOT EXISTS ${process.env.CASSANDRA_KEYSPACE}.keys `;
    query += " ( owner varchar, keychain map<text, text>, PRIMARY KEY (owner) ) ";
    query += " WITH comment = 'storing keys';";
    await client.execute(query);

}

async function insertSingle() {
    let def = uuid();
    let keys = { "default": def, [uuid()]: def };
    for (let i = 0;i <10; i++) {
        keys[uuid()] = uuid();
    }
    let query = "INSERT INTO keys (owner,keychain) VALUES (:owner,:keychain);";
    let params = { 
        owner: uuid(),
        keychain: keys
    };
    try {
        await client.execute(query, params, {prepare: true});
        return true;
    } catch (err) /* istanbul ignore next */ {
        console.log("Cassandra insert error", { error: err.message, query: query, params: params });
        return false;
    }
}

async function updateSingle(owner) {
    let query = "UPDATE keys SET keychain['default'] = :newKey, keychain[:newId] = :newKey WHERE owner = :owner;";
    let params = { 
        owner,
        newId: uuid(),
        newKey: uuid()
    };
    console.log("new:", params.newKey);
    try {
        await client.execute(query, params, {prepare: true});
        return true;
    } catch (err) /* istanbul ignore next */ {
        console.log("Cassandra insert error", { error: err.message, query: query, params: params });
        return false;
    }
}

async function insertMass() {
    for (let i = 0;i <10; i++) {
        await insertSingle();
    }
}

async function query(owner, id) {
    let query = `SELECT owner,keychain FROM ${process.env.CASSANDRA_KEYSPACE}.keys WHERE owner = :owner;`;
    let params = { 
        owner
    };
    try {
        let result = await client.execute(query, params, {prepare: true});
        let row = result.first();
        if (row) {
            let keychain = row.get("keychain");            
            if (id) return keychain[id];
            return keychain["default"];
        }
        return null;
    } catch (err) /* istanbul ignore next */ {
        console.log("Cassandra insert error", { error: err.message, query: query, params: params });
        return null;
    }
}

async function run() {
    await connect();
    console.log("Connected");
    await createTable();
    console.log("Table created");
    // await insertMass();
    // console.log("Records created");
    let result = await query("3211cae0-d734-42db-9005-53cd07f930a5");
    console.log("Query:",util.inspect(result,false,9,true));
    await updateSingle("3211cae0-d734-42db-9005-53cd07f930a5");
    let owner = uuid();
    await updateSingle(owner);
    await updateSingle(owner);
    result = await query("3211cae0-d734-42db-9005-53cd07f930a5");
    console.log("Query:",util.inspect(result,false,9,true));
    /*
    result = await query("c53c73e4-19d4-4ecb-8628-2d395164e591","ab75c18b-54c8-477a-bf93-93390e01705a");
    console.log("Query:",util.inspect(result,false,9,true));
    */
    await disconnect();
    console.log("Disconnected");
}

run();





