"use strict";

const { ServiceBroker } = require("moleculer");
const { Master } = require("../index");
const crypto = require("crypto");
const fs = require("fs");
// const util = require("util");

const timestamp = Date.now();
const serviceCalling = "my.service";
const serviceNameMaster = "master1";
const serviceNameKeys = "keys1";

process.env.MASTER_TOKEN = crypto.randomBytes(32).toString("hex");
process.env.SERVICE_TOKEN = crypto.randomBytes(32).toString("hex");

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
        cassandra: {
            contactPoints: process.env.CASSANDRA_CONTACTPOINTS || "127.0.0.1", 
            datacenter: process.env.CASSANDRA_DATACENTER || "datacenter1", 
            keyspace: process.env.CASSANDRA_KEYSPACE || "imicros_flow" 
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
        
        let shares, part, token;
        
        it("it should init the master", async () => {
            let params = {
                token: process.env.MASTER_TOKEN
            };
            let res = await broker.call(serviceNameMaster + ".init", params);
            expect(res.shares).toBeDefined();
            expect(res.shares.length).toEqual(5);
            shares = res.shares;
            part = shares.slice(2,5);
        });

        it("it should retrieve token", async () => {
            let params = {
                share: shares[1]
            };
            let res = await broker.call(serviceNameMaster + ".getToken", params);
            expect(res.token).toBeDefined();
            // console.log(res);
            token = res.token;
        });

        it("it should return 3 nodeID's of sealed (getSealed)", async () => {
            let params = {
                token: token
            };
            let res = await broker.call(serviceNameMaster + ".getSealed", params);
            expect(res).toBeDefined();
            expect(res.sealed).toBeDefined();
            expect(res.sealed.length).toBeGreaterThanOrEqual(1);
            expect(res.sealed.length).toEqual(3);
        });

       
        it("it should create a new share", async () => {
            let params = {
                token: process.env.MASTER_TOKEN,
                index: 2,
                shares: part
            };
            let res = await broker.call(serviceNameMaster + ".newShare", params);
            expect(res.share).toBeDefined();
            // console.log(res);
            shares[2] = res.share;
        });

        it("it should commit the first share (unseal)", async () => {
            let params = {
                nodeID: broker.nodeID,
                share: shares[0]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            expect(res.received).toEqual(1);
        });

        it("it should allow double commits (unseal)", async () => {
            let params = {
                nodeID: broker.nodeID,
                share: shares[0]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            expect(res.received).toEqual(1);
        });

        it("it should throw Error: unvalid token (unseal)", async () => {
            let params = {
                nodeID: broker.nodeID,
                share: "wrong share"
            };
            await broker.call(serviceNameMaster + ".unseal", params).catch(err => {
                expect(err instanceof Error).toBe(true);
                expect(err.message).toEqual("Invalid share");
            });
        });

        it("it should commit the second share (unseal)", async () => {
            let params = {
                nodeID: broker.nodeID,
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
                share: shares[4]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            await broker.waitForServices([serviceNameKeys]);
            expect(res.received).toEqual(3);
        },10000);
        
        it("it should return 2 nodeID's (getSealed)", async () => {
            let params = {
                token: token
            };
            let res = await broker.call(serviceNameMaster + ".getSealed", params);
            expect(res).toBeDefined();
            expect(res.sealed).toBeDefined();
            expect(res.sealed.length).toBeGreaterThanOrEqual(1);
            expect(res.sealed.length).toBeLessThan(3);
            expect(res.sealed.length).toEqual(2);
            //console.log(res);
        });
        
        it("it should commit the first share (unseal)", async () => {
            let params = {
                nodeID: brokerA.nodeID,
                share: shares[0]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            expect(res.received).toEqual(1);
        });

        it("it should commit the second share (unseal)", async () => {
            let params = {
                nodeID: brokerA.nodeID,
                share: shares[2]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            expect(res.received).toEqual(2);
        });
        
        it("it should unseal the master of second node (unseal)", async () => {
            let params = {
                nodeID: brokerA.nodeID,
                share: shares[4]
            };
            let res = await broker.call(serviceNameMaster + ".unseal", params);
            await brokerA.waitForServices([serviceNameKeys]).delay(1000);
            expect(res.received).toEqual(3);
        },10000);
        
        it("it should return 1 nodeID (getSealed)", async () => {
            let params = {
                token: token
            };
            let res = await broker.call(serviceNameMaster + ".getSealed", params);
            expect(res).toBeDefined();
            expect(res.sealed).toBeDefined();
            expect(res.sealed.length).toBeGreaterThanOrEqual(1);
            expect(res.sealed.length).toBeLessThan(3);
            expect(res.sealed.length).toEqual(1);
            // console.log(res);
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

        it("it should get new default key of service", () => {
            let params = {
                token: process.env.SERVICE_TOKEN,
                service: `${serviceCalling}${timestamp}`
            };
            return broker.call(serviceNameKeys  +  ".getSek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                keyA = res;
            });
            
        });

        it("it should get default key of service", () => {
            let params = {
                token: process.env.SERVICE_TOKEN,
                service: `${serviceCalling}${timestamp}`
            };
            return broker.call(serviceNameKeys  +  ".getSek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyA);
            });
            
        });
       
        it("it should create new default key of service", () => {
            expired = true;
            let params = {
                token: process.env.SERVICE_TOKEN,
                service: `${serviceCalling}${timestamp}`
            };
            return broker.call(serviceNameKeys  +  ".getSek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                keyB = res;
                expect(res).not.toEqual(keyA);
            });
            
        });

        it("it should get first key of service", () => {
            let params = {
                token: process.env.SERVICE_TOKEN,
                service: `${serviceCalling}${timestamp}`,
                id: keyA.id
            };
            return broker.call(serviceNameKeys  +  ".getSek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyA);
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
        
        it("it should remove an owner", () => {
            let params = {
                owner: `g1-${timestamp}`
            };
            return broker.call(serviceNameKeys  +  ".deleteOwner", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.owner).toBeDefined();
                expect(res.owner).toEqual(params.owner);
                expect(res.services).toBeDefined();
                expect(res.services[serviceCalling]).toBeDefined();
                expect(res.services[serviceCalling].default).toBeDefined();
                expect(res.services["my.second.service"]).toBeDefined();
                expect(res.services["my.second.service"].default).toBeDefined();
                // console.log(util.inspect(res,false,9,true));
            });
        });
        
        it("it should remove the second owner", () => {
            let params = {
                owner: `g2-${timestamp}`
            };
            return broker.call(serviceNameKeys  +  ".deleteOwner", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.owner).toBeDefined();
                expect(res.owner).toEqual(params.owner);
                expect(res.services[serviceCalling]).toBeDefined();
                expect(res.services[serviceCalling].default).toBeDefined();
                // console.log(util.inspect(res,false,9,true));
            });
        });
        
    });

    describe("Test stop broker", () => {
        it("should stop the broker", async () => {
            expect.assertions(1);
            await brokerA.stop();
            await brokerB.stop();
            await broker.stop();
            expect(broker).toBeDefined();
        });
    });
    
});