const secrets = require("secrets.js-grempe");

// generate a 512-bit key
let key = secrets.random(512); // => key is a hex string
 
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
 
// combine 5 shares of the copied array
comb = secrets.combine( copy.slice(4,9) );
console.log(comb === key); // => true
 
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

