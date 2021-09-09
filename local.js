process.env.CASSANDRA_CONTACTPOINTS = "192.168.2.124";
process.env.CASSANDRA_DATACENTER = "datacenter1";
process.env.CASSANDRA_KEYSPACE = "imicros_keys";

process.env.REDIS_HOST = "192.168.2.124";
process.env.REDIS_PORT = 6379;
process.env.REDIS_AUTH = "";
process.env.REDIS_DB = 1;
process.env.NATS_URL = "nats://192.168.2.124:4222";
module.exports = {
    "collectCoverageFrom": [
        "lib/*.js",
        "lib/util/*.js",
        "!lib/globals.js"
    ],
    "testEnvironment": "node"
};
