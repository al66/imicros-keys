/**
 * @license MIT, imicros.de (c) 2021 Andreas Leinen
 *
 */
"use strict";

const axios = require("axios");

const stopSignals = [
    "SIGHUP",
    "SIGINT",
    "SIGQUIT",
    "SIGILL",
    "SIGTRAP",
    "SIGABRT",
    "SIGBUS",
    "SIGFPE",
    "SIGUSR1",
    "SIGSEGV",
    "SIGUSR2",
    "SIGTERM"
];

class Unseal {
    
    /**
     * start task runner
     */
    start () {

        stopSignals.forEach((signal) => {
            process.on(signal,() => {
                console.log(`got ${signal} signal, stopping....`);
                this.stop();
            });
        });

        const self = this;
        this.job = setInterval(async () => {
            if (!this.stopped) await self.unseal();
        }, 1000);
        console.log("unseal service started");
    }
        
    /**
     * stop task runner  
     */
    async stop() {
        this.stopped = true;
        clearInterval(this.job);
        console.log("unseal service stopped");
    }

    /**
     * set config parameters vie environment variables or directly (for unit test)
     */
    config(settings = {}) {
        this.host = settings.host || process.env.HOST;
        this.share = settings.share || process.env.SHARE;
        this.service = settings.service || process.env.SERVICE;
        if (!this.host) {
            console.log("Missing argument host");
            process.exit(1);
        }
        if (!this.share) {
            console.log("Missing argument share");
            process.exit(1);
        }
        if (!this.service) {
            console.log("Missing argument service");
            process.exit(1);
        }
    }

    /**
     * unseal  
     */
    async unseal() {
        if (this.token) {
            console.log("call verifyToken:" + `${this.host}/${this.service}/verify`);
            try {
                let response = await axios.post(`${this.host}/${this.service}/verify`, {
                    token: this.token
                });
                if (!response.data.valid) this.token = null;
            } catch(err) {
                this.token = null;
            }
        }
        if (!this.token) {
            console.log("call getToken:" + `${this.host}/${this.service}/getToken`);
            try {
                let response = await axios.post(`${this.host}/${this.service}/getToken`, {
                    share: this.share
                });
                this.token = response.data.token;
                console.log(response.data);
            } catch(err) {
                console.log(err);
            }
        }
        try {
            let response = await axios.post(`${this.host}/${this.service}/getSealed`, {
                token: this.token
            });
            let sealed = response?.data?.sealed ?? [];
            console.log("Sealed nodes:", sealed);
            sealed.forEach(async nodeID => {
                await axios.post(`${this.host}/${this.service}/unseal`, {
                    nodeID,
                    share: this.share
                });
            });
        } catch(err) {
            console.log(err);
        }
        console.log("unseal called");
    }
            
}

module.exports = Unseal;

if (require.main === module) {
    const runner = new Unseal();
    runner.config();
    runner.start();
}
