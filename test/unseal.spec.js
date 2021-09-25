"use strict";

const { ServiceBroker } = require("moleculer");
const { Gateway } = require("imicros-gateway");
const { Unseal } = require("../index");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
// const util = require("util");

const share = crypto.randomBytes(256).toString("hex");
const secret = crypto.randomBytes(40).toString("hex");
let exp = new Date();
exp.setDate(new Date().getDate() + 60);
const token = jwt.sign({ any: "data", exp: Math.floor(exp.getTime() / 1000)}, secret);
let sealed = ["NODE_A", "NODE_B"];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// mock gateway service
const GatewayService = {
    name: "gateway",
    mixins: [Gateway],
    version: 1,
    settings: {
        services: {
            master: "master"
        },
        routes: [
            {
                path: "/",

                bodyParsers: {
                    json: true
                },

                authorization: true
            },
            {
                path: "/master/getToken",

                bodyParsers: {
                    json: true
                },
                
                authorization: false,

                aliases: {
                    "POST /": "v2.master.getToken"
                }
            },
            {
                path: "/master/verify",

                bodyParsers: {
                    json: true
                },
                
                authorization: false,

                aliases: {
                    "POST /": "v2.master.verify"
                }
            },
            {
                path: "/master/getSealed",

                bodyParsers: {
                    json: true
                },
                
                authorization: false,

                aliases: {
                    "POST /": "v2.master.getSealed"
                }
            },
            {
                path: "/master/unseal",

                bodyParsers: {
                    json: true
                },
                
                authorization: false ,
                
                aliases: {
                    "POST /": "v2.master.unseal"
                }
            }
        ]
    }
    
};

// mock master service
const MasterService = {
    name: "master",
    version: 2,
    actions: {
        getToken: {
            handler(ctx) {
                if (ctx.params.share === share) return {
                    token
                };
            }
        },
        verify: {
            handler(ctx) {
                if (ctx.params.token === token) return { valid: true };
                return { valid: false };
            }
        },
        getSealed: {
            handler(ctx) {
                if (ctx.params.token === token) return {
                    sealed
                };
            }
        },
        unseal: {
            handler(ctx) {
                if (sealed.indexOf(ctx.params.nodeID) >= 0) {
                    sealed.splice(sealed.indexOf(ctx.params.nodeID), 1);
                    console.log("unseal called for node: " + ctx.params.nodeID);
                    return {
                        received: 1
                    };
                }
                throw new Error("master is already unsealed");
            }
        }
    }
};

describe("Test unseal service", () => {

    let broker, service, gatewayService, masterService;
    beforeAll(() => {
    });
    
    afterAll(async () => {
    });
    
    describe("Test start service", () => {


        it("it should start the broker", async () => {
            broker = new ServiceBroker({
                logger: console,
                logLevel: "info" //"debug"
            });
            gatewayService = broker.createService(GatewayService);
            masterService = broker.createService(MasterService);
            await broker.start();
            // server = gatewayService.server;
            expect(gatewayService).toBeDefined();
            expect(masterService).toBeDefined();
        });


        it("it should start the service", async () => {
            service = new Unseal();
            service.config({
                share,
                host: "http://localhost:3000",
                service: "master"
            });
            expect(sealed.length).toEqual(2);
            service.start();
            expect(service).toBeDefined();
            await sleep(4000);
            expect(sealed.length).toEqual(0);
        });

    });

    describe("Test stop service", () => {
        it("should stop the service", async () => {
            expect.assertions(1);
            service.stop();
            expect(service).toBeDefined();
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

