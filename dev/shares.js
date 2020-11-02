const secrets = require("secrets.js-grempe");
const crypto = require("crypto");

// generate a 512-bit key
let key = secrets.random(512); // => key is a hex string

function hashKey (key) {
    try {
        let salt = crypto.randomBytes(16);
        let hash = crypto.pbkdf2Sync(key, salt, 100000, 32, "sha512");
        let combined = Buffer.alloc(hash.length + salt.length + 8);
        // include the size of the salt so that we can, during verification,
        // figure out how much of the hash is salt
        combined.writeUInt32BE(salt.length, 0, true);
        // similarly, include the iteration count
        combined.writeUInt32BE(100000, 4, true);
        salt.copy(combined, 8);
        hash.copy(combined, salt.length + 8);
        let combinedStr = combined.toString("hex");
        return combinedStr;
    } catch (err) {
        throw new Error("Failed to create hash");
    }
}

// split into 10 shares with a threshold of 5
let shares = secrets.share(key, 10, 5);
let copy = [];
console.log(shares);
// => shares = ['801xxx...xxx','802xxx...xxx','803xxx...xxx','804xxx...xxx','805xxx...xxx']
shares.map(share => {
    let components = secrets.extractShareComponents(share);
    console.log(components.id, copy.length);
    copy[components.id] = share;
});

// combine 4 shares
let comb = secrets.combine( shares.slice(0,4) );
console.log(comb === key); // => false

// combine 5 shares
comb = secrets.combine( shares.slice(4,9) );
console.log(comb);
console.log(comb === key); // => true
let hash = hashKey(comb);

// combine 5 shares of the copied array
comb = secrets.combine( copy.slice(4,9) );
console.log(comb === key); // => true
console.log(hash === hashKey(comb)); // true
 
// combine ALL shares
comb = secrets.combine( shares );
console.log(comb === key); // => true

// create new share
let newShare = secrets.newShare( 6, shares.slice(0,5) );
console.log(newShare); // => '805xxx...xxx'
shares[5] = newShare;
console.log(shares);

// combine 5 shares including the new share
comb = secrets.combine( shares.slice(4,9) );
console.log(comb === key); // => true

