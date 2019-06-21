"use strict";

const { ServiceBroker } = require("moleculer");

const Middleware = {

    async started(broker) {
        await console.log("Broker started");
        await broker.waitForServices(["master"]).then(async () => {
            let params = {}, opt = {};
            let result = await broker.call("master.getMasterKey",params,opt);
            await  console.log("result:", result);
        });
    },
    
    // Before broker starting (async)
    async starting(broker) {
        await console.log("Broker is starting");
    },

    // After broker is created
    async created(broker) {
        await console.log("Created");
    }
    
};

const Service = {
    name: "Dummy"
};

const Master = {
    name: "master",
    actions: {
        getMasterKey: {
            async handler(ctx) {
                return "xyz";
            }
        }
    }
};

let masterBroker = new ServiceBroker({
    namespace: "dev",
    nodeID: "A1-master",
    transporter: "nats://192.168.2.124:4222",
    logger: console,
    logLevel: "info" //"debug"
});
masterBroker.createService(Master);
masterBroker.start()
.then(async () => {
    let broker = new ServiceBroker({
        namespace: "dev",
        nodeID: "A1-client",
        transporter: "nats://192.168.2.124:4222",
        logger: console,
        logLevel: "info", //"debug"
        middlewares: [Middleware],
    });
    broker.createService(Service);
    broker.start()
    .then(async () => {
        await console.log("Started");
    })
    .then(async () => {
        await broker.stop(); 
        await masterBroker.stop(); 
    });

});

