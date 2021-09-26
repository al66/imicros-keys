process.env.CASSANDRA_CONTACTPOINTS = "192.168.2.124";
process.env.CASSANDRA_DATACENTER = "datacenter1";
process.env.CASSANDRA_KEYSPACE = "imicros_keys";
process.env.CASSANDRA_PORT = 31326;
process.env.CASSANDRA_USER = "cassandra";
process.env.CASSANDRA_PASSWORD = "cassandra";

module.exports = {
    "collectCoverageFrom": [
        "lib/*.js",
        "lib/util/*.js",
        "!lib/globals.js"
    ],
    "testEnvironment": "node"
};
