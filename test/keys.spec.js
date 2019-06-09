"use strict";

const { ServiceBroker } = require("moleculer");
const { Keys } = require("../index");

const timestamp = Date.now();

let expired;
//const _Date = Date;
//global.Date = _Date;
global.Date.now = () => { return expired ? timestamp + ( 1000 * 60 * 60 * 24 * 31 ) : timestamp ; };
/*
global.Date = jest.fn(() => timestamp); //expired ? timestamp + ( 1000 * 60 * 60 * 24 * 31 ) : timestamp
global.Date.UTC = _Date.UTC;
global.Date.parse = _Date.parse;
global.Date.now = _Date.now;
*/

describe("Test keys service", () => {

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
            service = await broker.createService(Keys, Object.assign({ 
                name: "keys", 
                settings: { 
                    redis: {
                        port: process.env.REDIS_PORT || 6379,
                        host: process.env.REDIS_HOST || "127.0.0.1",
                        password: process.env.REDIS_AUTH || "",
                        db: process.env.REDIS_DB || 0,
                    }
                }
            }));
            await broker.start();
            expect(service).toBeDefined();
        });

    });
    
    describe("Test getOek", () => {

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