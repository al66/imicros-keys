const secrets = require("secret-sharing.js");

// generate a 512-bit key
let key = secrets.random(512); // => key is a hex string
 
// split into 10 shares with a threshold of 5
let shares = secrets.share(key, 10, 5);
console.log(shares);
// => shares = ['801xxx...xxx','802xxx...xxx','803xxx...xxx','804xxx...xxx','805xxx...xxx']
 
// combine 4 shares
let comb = secrets.combine( shares.slice(0,4) );
console.log(comb === key); // => false
 
// combine 5 shares
comb = secrets.combine( shares.slice(4,9) );
console.log(comb);
console.log(comb === key); // => true
 
// combine ALL shares
comb = secrets.combine( shares );
console.log(comb === key); // => true