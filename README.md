# imicros-keys
[![Build Status](https://travis-ci.org/al66/imicros-keys.svg?branch=master)](https://travis-ci.org/al66/imicros-keys)
[![Coverage Status](https://coveralls.io/repos/github/al66/imicros-keys/badge.svg?branch=master)](https://coveralls.io/github/al66/imicros-keys?branch=master)

[Moleculer](https://github.com/moleculerjs/moleculer) service for the imicros key store 

## Installation
```
$ npm install imicros-keys --save
```
## Dependencies
Requires a running Redis Instance.

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
After the first start call <code>master.init</code>code> to generate a new master key and retrieve the secret shares and the verifcation hash.
Keep the shares as well as the verification hash very save as the master key cannot be changed!

The following steps must be done after each restart:
- set the verfication hash for each sealed node with <code>master.setVerifyHash</code>. Alternatively you can set the environment variable <code>process.env.MASTER_HASH</code>, as you know it after the first init call.
- call <code>master.unseal</code> with the different shares until the required number of shares is reached
When the required number of shares is reached the node is unsealed and the keys service is started automatically.

Services can now retrieve their secret keys with calling <code>keys.getOek</code>.
### Actions master service
```
init { token } => { shares, verifyHash } 
setVerifyHash { nodeID, token, verifyHash } => { verifyHash } 
unseal { nodeID, token, share } => { received }
isSealed => true|false
getSealed { token } => { sealed:Array<String> }
getMasterKey { token } => masterKey  - only local calls!
```
### Actions key service
```
getOek { service, id } => { id, key }
owners => [ owner id's ]
```
#### init
Called only once for all key services to retrieve shares and the verification hash.
It generates a new master key and split it into the secret shares. 
These shares and the verification hash must be used for unsealing all running key services.
Never change them in a running system with existing keys in the database! 
```js
let param = {
    token: "my secret master token"
}
broker.call("master.init", param).then(res => {
    // res.shares -> array of secret shares
    // res.verifyHash -> combined hash/salt
})
```
#### getSealed
Returns an array of node ID's of sealed nodes. If all nodes are unsealed, the array is empty.
```js
let param = {
    token: "my secret master token"
}
broker.call("master.getSealed", param).then(res => {
    // res.sealed -> array of node ID's
})
```
#### setVerifyHash
Set the verification hash for sealed nodes. Must be called for each sealed node with the related node ID.
```js
let param = {
    nodeID: "...",          // as retrieved by master.getSealed
    token: "my secret master token",
    verifyHash: "..."       // as retrived by master.init
}
broker.call("master.setVerifyHash", param).then(res => {
    // res.verifyHash -> in case of success: same value as transferred
})
```
#### unseal
Set a share for reconstruction of the master key and unsealing the node.
Must be called for each sealed node ID with different shares until the required number of shares is reached.
When the required number is reached the node is automatically unsealed and the key service is started.
```js
let param = {
    nodeID: "...",          // as retrieved by master.getSealed
    token: "my secret master token",
    share: "..."            // as retrived by master.init
}
broker.call("master.unseal", param).then(res => {
    // res.retrieved -> number of retrieved (different) shares
})
```
#### getOek
Called by other services to retrieve their own secret.
It is called w/o ID for getting the default key - e.g. for encrypting.
After reaching the exiry date (according expiration days in settings) a new default key is created.
The retrieved id must be saved with the encrypted object to retrieve the correct key for decryption.
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



