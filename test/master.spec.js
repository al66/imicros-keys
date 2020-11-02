"use strict";

const { ServiceBroker } = require("moleculer");
const { Master } = require("../index");
const crypto = require("crypto");
const fs = require("fs");
const util = require("util");

const timestamp = Date.now();
const serviceCalling = "my.service";
const serviceNameMaster = "master1";
const serviceNameKeys = "keys1";

process.env.MASTER_TOKEN = crypto.randomBytes(32).toString("hex");

// delete init.conf if exists from earlier runs
try {
    fs.unlinkSync("init.conf");
} catch (err) {
    // ok
}

const MasterService = Object.assign(Master, { 
    name: serviceNameMaster,
    settings: {
        nameKeysService: serviceNameKeys,
        redis: {
            port: process.env.REDIS_PORT || 6379,
            host: process.env.REDIS_HOST || "127.0.0.1",
            password: process.env.REDIS_AUTH || "",
            db: process.env.REDIS_DB || 0,
        },
        expirationDays: 20
    }
});

const expirationDays = 20;
let expired;
global.Date.now = () => { return expired ? timestamp + ( 1000 * 60 * 60 * 24 * ( expirationDays + 1) ) : timestamp ; };

describe("Test master/key service", () => {

    const [broker, brokerA, brokerB] = ["first", "second", "third"].map(nodeID => {
        return new ServiceBroker({
            nodeID: nodeID,
            transporter: "TCP",
            logger: console,
            logLevel: "info" //"debug"
        });
    });
    
    // Load services
    [broker, brokerA, brokerB].forEach(broker => broker.createService(MasterService));
    // Load dummy services
    brokerA.createService({ name: "nodeA" });
    brokerB.createService({ name: "nodeB" });
        

    // let broker, service, brokerA, brokerB;
    beforeAll(async () => {
        // Start broker
        await Promise.all([broker.start(), brokerA.start(), brokerB.start()]);

        // Ensure services & all brokers are available
        await brokerA.waitForServices([serviceNameMaster,"nodeA"]);
        await brokerB.waitForServices([serviceNameMaster,"nodeB"]);
        await broker.waitForServices([serviceNameMaster,"nodeA","nodeB"]);
    }, 10000);
    
    afterAll(async () => {
        // Stop broker
        await Promise.all([brokerA.stop(), brokerB.stop(), broker.stop()]);
    }, 10000);
    
    describe("Test master", () => {
        
        let shares, verifyHash, part;
        
        it("it should return 3 nodeID's of sealed (getSealed)", async () => {
            let params = {
                token: process.env.MASTER_TOKEN
            };
            let res = await broker.call(serviceNameMaster + ".getSealed", params);
            expect(res).toBeDefined();
            expect(res.sealed).toBeDefined();
            expect(res.sealed.length).toBeGreaterThanOrEqual(1);
            expect(res.sealed.length).toEqual(3);
        });

        it("it should init the master", async () => {
            let params = {
                token: process.env.MASTER_TOKEN
            };
            let res = await broker.call(serviceNameMaster + ".init", params);
            expect(res.shares).toBeDefined();
            expect(res.shares.length).toEqual(5);
            expect(res.verifyHash).toBeDefined();
            shares = res.shares;
            part = shares.slice(2,5);
            // verifyHash = res.verifyHash;
            // console.log(res);
        });

        it("it should recreate the hash", async () => {
            let params = {
                token: process.env.MASTER_TOKEN,
                shares: part
            };
            let res = await broker.call(serviceNameMaster + ".getVerifyHash", params);
            expect(res.verifyHash).toBeDefined();
            console.log(res);
            verifyHash = res.verifyHash;
        });

        it("it should create a new share", async () => {
            let params = {
                token: process.env.MASTER_TOKEN,
                index: 2,
                shares: part
            };
            let res = await broker.call(serviceNameMaster + ".newShare", params);
            expect(res.share).toBeDefined();
            console.log(res);
            shares[2] = res.share;
        });

        it("it should set the verifyHash", async () => {
            let params = {
                nodeID: broker.nodeID,
                token: process.env.MASTER_TOKEN,
                verifyHash: verifyHash
            };
            let res = await broker.call(serviceNameMaster + ".setVerifyHash", params);
            expect(res.verifyHash).toBeDefined();
            expect(res.verifyHash).toEqual(verifyHash);
        });

        it("it should commit the first share (unseal)", async () => {
            let params = {
                nodeID: broker.nodeID,
                token: process.env.MASTER_TOKEN,
                share: shares[0]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            expect(res.received).toEqual(1);
        });

        it("it should allow double commits (unseal)", async () => {
            let params = {
                nodeID: broker.nodeID,
                token: process.env.MASTER_TOKEN,
                share: shares[0]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            expect(res.received).toEqual(1);
        });

        it("it should throw Error: unvalid token (unseal)", async () => {
            let params = {
                nodeID: broker.nodeID,
                token: "wrong token",
                share: shares[0]
            };
            await broker.call(serviceNameMaster + ".unseal", params).catch(err => {
                expect(err instanceof Error).toBe(true);
                expect(err.message).toEqual("invalid token");
            });
        });

        it("it should commit the second share (unseal)", async () => {
            let params = {
                nodeID: broker.nodeID,
                token: process.env.MASTER_TOKEN,
                share: shares[2]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            expect(res.received).toEqual(2);
        });
        
        it("it should throw Error: this method can only be called once", async () => {
            let params = {
                token: process.env.MASTER_TOKEN
            };
            await broker.call(serviceNameMaster + ".init", params).catch(err => {
                expect(err instanceof Error).toBe(true);
                expect(err.message).toEqual("this method can only be called once");
            });
        });

        it("it should unseal the master (unseal)", async () => {
            let params = {
                nodeID: broker.nodeID,
                token: process.env.MASTER_TOKEN,
                share: shares[4]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            await broker.waitForServices([serviceNameKeys]);
            expect(res.received).toEqual(3);
        },10000);
        
        it("it should return 2 nodeID's (getSealed)", async () => {
            let params = {
                token: process.env.MASTER_TOKEN
            };
            let res = await broker.call(serviceNameMaster + ".getSealed", params);
            expect(res).toBeDefined();
            expect(res.sealed).toBeDefined();
            expect(res.sealed.length).toBeGreaterThanOrEqual(1);
            expect(res.sealed.length).toBeLessThan(3);
            expect(res.sealed.length).toEqual(2);
            //console.log(res);
        });
        
        it("it should set the verifyHash for second node", async () => {
            let params = {
                nodeID: brokerA.nodeID,
                token: process.env.MASTER_TOKEN,
                verifyHash: verifyHash
            };
            let res = await broker.call(serviceNameMaster + ".setVerifyHash", params);
            expect(res.verifyHash).toBeDefined();
            expect(res.verifyHash).toEqual(verifyHash);
        });

        it("it should commit the first share (unseal)", async () => {
            let params = {
                nodeID: brokerA.nodeID,
                token: process.env.MASTER_TOKEN,
                share: shares[0]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            expect(res.received).toEqual(1);
        });

        it("it should commit the second share (unseal)", async () => {
            let params = {
                nodeID: brokerA.nodeID,
                token: process.env.MASTER_TOKEN,
                share: shares[2]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            expect(res.received).toEqual(2);
        });
        
        it("it should unseal the master of second node (unseal)", async () => {
            let params = {
                nodeID: brokerA.nodeID,
                token: process.env.MASTER_TOKEN,
                share: shares[4]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            await brokerA.waitForServices([serviceNameKeys]).delay(1000);
            expect(res.received).toEqual(3);
        },10000);
        
        it("it should return 1 nodeID (getSealed)", async () => {
            let params = {
                token: process.env.MASTER_TOKEN
            };
            let res = await broker.call(serviceNameMaster + ".getSealed", params);
            expect(res).toBeDefined();
            expect(res.sealed).toBeDefined();
            expect(res.sealed.length).toBeGreaterThanOrEqual(1);
            expect(res.sealed.length).toBeLessThan(3);
            expect(res.sealed.length).toEqual(1);
            //console.log(res);
        });
        
    });
    
    describe("Test keys", () => {

        let opts, keyA, keyB, keyC, keyD;

        beforeAll(async () => {
            // Ensure services & all brokers are available
            await broker.waitForServices([serviceNameKeys]);
            await brokerB.waitForServices([serviceNameKeys]);
        },10000);
        
        beforeEach(() => {
            expired = null;
            opts = { 
                meta: { 
                    acl: {
                        accessToken: "this is the access token",
                        ownerId: `g1-${timestamp}`
                    }, 
                    user: { 
                        id: `1-${timestamp}` , 
                        email: `1-${timestamp}@host.com` }, 
                    access: [`1-${timestamp}`, `2-${timestamp}`] 
                } 
            };
        });
        
        it("it should create default key of 1. owner", () => {
            let params = {
                service: serviceCalling
            };
            return broker.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                keyA = res;
            });
            
        });

        it("it should get default key of 1. owner", () => {
            let params = {
                service: serviceCalling
            };
            return brokerB.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyA);
            });
            
        });

        it("it should get key of 1. owner by id", () => {
            let params = {
                service: serviceCalling,
                id: keyA.id
            };
            return brokerB.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyA);
            });
            
        });

        it("it should throw error due to not existing id", () => {
            let params = {
                service: serviceCalling,
                id: "not existing"
            };
            return brokerB.call(serviceNameKeys  +  ".getOek", params, opts).catch(err => {
                expect(err.message).toEqual("failed to retrieve key");
            });
        });

        it("it should create default key of 2. owner", () => {
            opts.meta.acl.ownerId = `g2-${timestamp}`;
            let params = {
                service: serviceCalling
            };
            return broker.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                keyB = res;
            });
            
        });

        it("it should get default key of 2. owner", () => {
            opts.meta.acl.ownerId = `g2-${timestamp}`;
            let params = {
                service: serviceCalling
            };
            return broker.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyB);
            });
            
        });

        it("it should get key of 2. owner by id", () => {
            opts.meta.acl.ownerId = `g2-${timestamp}`;
            let params = {
                service: serviceCalling,
                id: keyB.id
            };
            return broker.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyB);
            });
            
        });

        it("it should create default key of 1. owner 2. service", () => {
            let params = {
                service: "my.second.service"
            };
            return broker.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                keyC = res;
            });
            
        });

        it("it should get default key of 1. owner 2. service", () => {
            let params = {
                service: "my.second.service"
            };
            return broker.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyC);
                expect(res).not.toEqual(keyA);
            });
            
        });

        it("it should get again default key of 1. owner 1. service", () => {
            let params = {
                service: serviceCalling
            };
            return broker.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyA);
            });
            
        });

        it("it should create a new default key of 1. owner 1. service", () => {
            expired = true;
            let params = {
                service: serviceCalling
            };
            return broker.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                keyD = res;
                expect(res).not.toEqual(keyA);
            });
            
        });

        it("it should get new default key of 1. owner 1. service", () => {
            let params = {
                service: serviceCalling
            };
            return broker.call(serviceNameKeys  +  ".getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyD);
            });
            
        });

    });

    describe("Test admin", () => {

        let opts;

        beforeAll(() => {});
        
        beforeEach(() => {
            opts = { 
                meta: { 
                    acl: {
                        accessToken: "this is the access token",
                        ownerId: "admin",
                        core: true
                    }, 
                    user: { 
                        id: `1-${timestamp}` , 
                        email: `1-${timestamp}@host.com` }
                } 
            };
        });
        
        
        it("it should return known owners", () => {
            let params = {
            };
            return broker.call(serviceNameKeys  +  ".getOwners", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).toEqual(expect.arrayContaining([`g1-${timestamp}`,`g2-${timestamp}`]));
            });
        });

        it("it should remove an owner", () => {
            let params = {
                owner: `g1-${timestamp}`
            };
            return broker.call(serviceNameKeys  +  ".deleteOwner", params, opts).then(res => {
                expect(res).toBeDefined();
                console.log(util.inspect(res,false,9,true));
            });
        });
        
        it("it should return left owners", () => {
            let params = {
            };
            return broker.call(serviceNameKeys  +  ".getOwners", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).not.toEqual(expect.arrayContaining([`g1-${timestamp}`]));
                expect(res).toEqual(expect.arrayContaining([`g2-${timestamp}`]));
            });
        });

        it("it should remove the second owner", () => {
            let params = {
                owner: `g2-${timestamp}`
            };
            return broker.call(serviceNameKeys  +  ".deleteOwner", params, opts).then(res => {
                expect(res).toBeDefined();
                console.log(util.inspect(res,false,9,true));
            });
        });
        
        it("it should return left owners", () => {
            let params = {
            };
            return broker.call(serviceNameKeys  +  ".getOwners", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).not.toEqual(expect.arrayContaining([`g2-${timestamp}`]));
            });
            
        });
        
    });
    
});