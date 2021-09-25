# imicros-keys
[![Build Status](https://travis-ci.org/al66/imicros-keys.svg?branch=master)](https://travis-ci.org/al66/imicros-keys)
[![Coverage Status](https://coveralls.io/repos/github/al66/imicros-keys/badge.svg?branch=master)](https://coveralls.io/github/al66/imicros-keys?branch=master)

[Moleculer](https://github.com/moleculerjs/moleculer) service for the imicros key store 

## Installation
```
$ npm install imicros-keys --save
```
## Dependencies
Requires a running Cassandra Instance.

# Usage Keys Service
Set the master token as environment variable
```js
process.env.MASTER_TOKEN = "MCN`1T-:,P41!QQ"
```
```js
const { ServiceBroker } = require("moleculer");
const { Master } = require("imicros-keys");

broker = new ServiceBroker({
    logger: console
});
broker.createService(Master, Object.assign({ 
    settings: {
        redis: {
            port: process.env.REDIS_PORT || 6379,
            host: process.env.REDIS_HOST || "127.0.0.1",
            password: process.env.REDIS_AUTH || "",
            db: process.env.REDIS_DB || 0,
        },
        expirationDays: 30  // rotate key after 30 days
    }
}));
broker.start();

```
The keys service is not started directly - the master service will create it after unsealing.
After the first start call <code>master.init</code> to generate a new master key and retrieve the secret shares.

**Keep the shares very save as the master key cannot be changed!**

The following steps must be done after each restart with each single share:
- call <code>master.getToken</code> with your share to receive a token
- call <code>master.getSealed</code> with the received token to get the sealed nodes
- call <code>master.unseal</code> for each sealed node with your share
When the required number of shares is reached the node is unsealed and the keys service is started automatically.

The class unseal can be used to automate this process with a remote running daemon per share.
The daemon requires three environment variables:
```
process.env.HOST = "https://my-host"  // can include a port number e.g. https://my-host:3000
process.env.SHARE = "e1b4cb2904ba87e2bc49cf1c09c886d3d14cf6ec93652162393bd0254d066843fa966c04a1d754196bb8992bd268700215ec3b6fcf4b1881c6ff79b1288533f5843bc8388bb5645de96e4937d156fd57d8169f58278b7fb1d3405b322f8ce8fa09b243ac70e1f5a38ca314b2aa5d7a1565bd5aeb756ca97197a7a9656121328b2506c0a479340ab1fbbce67364e4a8353107f792e428e776bdf0c0e2e7666e9efa62fd4d59afcd418fbd37f53cb49bc3011f64c6c070fe9a97762b0c27172ad7c1a070189ee2924bc78fda6b716ceadc1a54ff83954304a24e34bcd02fa3db2356236167c17333fa0eb0562f9e52f4d83942fdec928b4f0bed66d23ee24366c1"  // one of the shares created with the init action
process.env.SERVICE = "master"
```
To run the daemon call (or use nodemon or pm2)
```
node /lib/unseal
```


Services can now retrieve their secret keys with calling <code>keys.getOek</code>.
### Actions master service
```
init { token } => { shares } 
unseal { nodeID, token, share } => { received }
isSealed => true|false
getSealed { token } => { unsealed:Array<String>, sealed:Array<String> }
getMasterKey { token } => masterKey  - only local calls!
```
### Actions key service
```
getOek { service, id } => { id, key }
getSek { token, service, id } => { id, key }
deleteKeys { owner } => backup: { owner, services: { [service]:[keychain] }}
```
#### init
Called only once for all key services to retrieve shares.
It generates a new master key and split it into the secret shares. 
These shares must be used for unsealing all running key services.
Never change them in a running system with existing keys in the database! 
```js
let param = {
    token: "my secret master token"
}
broker.call("master.init", param).then(res => {
    // res.shares -> array of secret shares
})
```
#### getToken
Get a token for a share to call getSealed. 
The token is just used to avoid transfering the share in each call. Therefore should be called only once at the start of the unsealing program.
Important note: For security reasons you will get always a token back - also, if the share is unvalid.
```js
let param = {
    share: "..."            // as retrived by master.init
}
broker.call("master.getToken", param).then(res => {
    // res.token -> token to be used for calling getSealed
})
```
#### getSealed
Returns an array of node ID's of sealed nodes. If all nodes are unsealed, the array is empty.
Important note: If the token is unvalid due to a wrong share in action getToken you will get an empty array back.
```js
let param = {
    token: "my secret token retrieved by calling getToken"
}
broker.call("master.getSealed", param).then(res => {
    // res.sealed -> array of node ID's
})
```
#### unseal
Set a share for reconstruction of the master key and unsealing the node.
Must be called for each sealed node ID with different shares until the required number of shares is reached.
When the required number is reached the node is automatically unsealed and the key service is started.
```js
let param = {
    nodeID: "...",          // as retrieved by master.getSealed
    share: "..."            // as retrived by master.init
}
broker.call("master.unseal", param).then(res => {
    // res.retrieved -> number of retrieved (different) shares
})
```
#### getOek
This method is called by other services to obtain their private key for encryption.
It is called without ID to get the default key for encryption.
After reaching the expiration date (according to the expiration days in the settings) a new default private key is generated.
The retrieved ID has to be stored with the encrypted object and has to be given with the new retrieval to get the correct key for decryption.
```js
let params = {
    service: "my service",                      // name of my service
    id: "35e53e27-3d91-4524-8c40-80566546f536"  // optional: getting the right key for decryption
},
broker.call("keys.getOek", param).then(res => {
    // res.id -> uuid of the key
    // res.key -> key
})
```



