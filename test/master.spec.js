"use strict";

const { ServiceBroker } = require("moleculer");
const { Master } = require("../index");
const crypto = require("crypto");
const fs = require("fs");

const timestamp = Date.now();

process.env.MASTER_TOKEN = crypto.randomBytes(32).toString("hex");

// delete init.conf if exists from earlier runs 
fs.unlinkSync("init.conf");

const expirationDays = 20;
let expired;
global.Date.now = () => { return expired ? timestamp + ( 1000 * 60 * 60 * 24 * ( expirationDays + 1) ) : timestamp ; };

describe("Test master/key service", () => {

    let broker, service;
    beforeAll(() => {
    });
    
    afterAll(async () => {
    });
    
    describe("Test create service", () => {

        it("it should start the broker", async () => {
            broker = new ServiceBroker({
                logger: console,
                logLevel: "info" //"debug"
            });
            service = await broker.createService(Master, Object.assign({ 
                name: "master_" + timestamp, 
                settings: {
                    redis: {
                        port: process.env.REDIS_PORT || 6379,
                        host: process.env.REDIS_HOST || "127.0.0.1",
                        password: process.env.REDIS_AUTH || "",
                        db: process.env.REDIS_DB || 0,
                    },
                    expirationDays: 20
                }
            }));
            await broker.start();
            expect(service).toBeDefined();
        });

    });

    describe("Test master", () => {
        
        let token, shares;
        
        it("it should init the master", async () => {
            let params = {
                token: process.env.MASTER_TOKEN
            };
            let res = await broker.call("master_" + timestamp + ".init", params);
            expect(res.token).toBeDefined();
            expect(res.shares).toBeDefined();
            expect(res.shares.length).toEqual(5);
            token = res.token;
            shares = res.shares;
        });

        it("it should commit the first share", async () => {
            let params = {
                token: token,
                share: shares[0]
            };
            let res = await broker.call("master_" + timestamp + ".unseal", params);
            expect(res.received).toEqual(1);
        });

        it("it should allow double commits", async () => {
            let params = {
                token: token,
                share: shares[0]
            };
            let res = await broker.call("master_" + timestamp + ".unseal", params);
            expect(res.received).toEqual(1);
        });

        it("it should throw Error: unvalid token", async () => {
            let params = {
                token: "wrong token",
                share: shares[0]
            };
            await broker.call("master_" + timestamp + ".unseal", params).catch(err => {
                expect(err instanceof Error).toBe(true);
                expect(err.message).toEqual("unvalid token");
            });
        });

        it("it should commit the second share", async () => {
            let params = {
                token: token,
                share: shares[2]
            };
            let res = await broker.call("master_" + timestamp + ".unseal", params);
            expect(res.received).toEqual(2);
        });
        
        it("it should throw Error: this method can only be called once", async () => {
            let params = {
                token: process.env.MASTER_TOKEN
            };
            await broker.call("master_" + timestamp + ".init", params).catch(err => {
                expect(err instanceof Error).toBe(true);
                expect(err.message).toEqual("this method can only be called once");
            });
        });

        it("it should unseal the master", async () => {
            let params = {
                token: token,
                share: shares[4]
            };
            let res = await broker.call("master_" + timestamp + ".unseal", params);
            await broker.waitForServices("keys");
            expect(res.received).toEqual(3);
        });
    });
    
    describe("Test keys", () => {

        let opts, keyA, keyB, keyC, keyD;
        
        beforeEach(() => {
            expired = null;
            opts = { 
                meta: { 
                    acl: {
                        accessToken: "this is the access token",
                        owner: {
                            id: `g1-${timestamp}`
                        }
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
                service: "my.service"
            };
            return broker.call("keys.getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                keyA = res;
            });
            
        });

        it("it should get default key of 1. owner", () => {
            let params = {
                service: "my.service"
            };
            return broker.call("keys.getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyA);
            });
            
        });

        it("it should get key of 1. owner by id", () => {
            let params = {
                service: "my.service",
                id: keyA.id
            };
            return broker.call("keys.getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyA);
            });
            
        });

        it("it should create default key of 2. owner", () => {
            opts.meta.acl.owner.id = `g2-${timestamp}`;
            let params = {
                service: "my.service"
            };
            return broker.call("keys.getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                keyB = res;
            });
            
        });

        it("it should get default key of 2. owner", () => {
            opts.meta.acl.owner.id = `g2-${timestamp}`;
            let params = {
                service: "my.service"
            };
            return broker.call("keys.getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyB);
            });
            
        });

        it("it should get key of 2. owner by id", () => {
            opts.meta.acl.owner.id = `g2-${timestamp}`;
            let params = {
                service: "my.service",
                id: keyB.id
            };
            return broker.call("keys.getOek", params, opts).then(res => {
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
            return broker.call("keys.getOek", params, opts).then(res => {
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
            return broker.call("keys.getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyC);
                expect(res).not.toEqual(keyA);
            });
            
        });

        it("it should get again default key of 1. owner 1. service", () => {
            let params = {
                service: "my.service"
            };
            return broker.call("keys.getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyA);
            });
            
        });

        it("it should create a new default key of 1. owner 1. service", () => {
            expired = true;
            let params = {
                service: "my.service"
            };
            return broker.call("keys.getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                keyD = res;
                expect(res).not.toEqual(keyA);
            });
            
        });

        it("it should get new default key of 1. owner 1. service", () => {
            let params = {
                service: "my.service"
            };
            return broker.call("keys.getOek", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.id).toBeDefined();
                expect(res.key).toBeDefined();
                expect(res).toEqual(keyD);
            });
            
        });
        
    });
    
    describe("Test stop broker", () => {
        it("should stop the broker", async () => {
            expect.assertions(1);
            await broker.stop();
            expect(broker).toBeDefined();
        });
    });    
    
});