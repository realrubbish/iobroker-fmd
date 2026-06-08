"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const utils = __importStar(require("@iobroker/adapter-core"));
const fmd_auth_1 = require("./lib/fmd-auth");
const fmd_api_1 = require("./lib/fmd-api");
/**
 * FMD Adapter for ioBroker
 * Rings FMD devices via ntfy push notifications
 */
class FmdAdapter extends utils.Adapter {
    fmdAuth;
    fmdApi;
    authTokens;
    connectionStatus = "disconnected";
    devices = new Map();
    // Hardcoded button trigger state ID from vision.md
    BUTTON_STATE_ID = "shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event";
    BUTTON_TRIGGER = "triple_push";
    constructor(options = {}) {
        super({
            ...options,
            name: "iobroker-fmd",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.on("message", this.onMessage.bind(this));
    }
    /**
     * Called when adapter is initialized
     */
    async onReady() {
        this.log.info("FMD adapter starting...");
        // Initialize connection status states
        await this.initConnectionStates();
        // Get config with proper typing - ioBroker stores in native
        const config = this.config;
        // Check if configuration is present
        if (!config.serverUrl || !config.username || !config.password) {
            this.log.warn("FMD configuration incomplete. Please set server URL, username, and password.");
            this.setConnectionStatus("disconnected");
            return;
        }
        // Initialize FMD Auth module
        this.fmdAuth = new fmd_auth_1.FmdAuth({
            serverUrl: config.serverUrl,
            username: config.username,
            password: config.password,
            log: this.log,
        });
        // Subscribe to button state for hardware trigger
        this.subscribeToButtonState();
        // Subscribe to ring states (see Bug B fix in the parent commit).
        // Without this, setState on 0_userdata.0.FindMyDevice.ring.<id>
        // never reaches onStateChange and the ring is never triggered.
        const ringPattern = "0_userdata.0.FindMyDevice.ring.*";
        this.subscribeStates(ringPattern);
        this.log.info(`[onReady] Subscribed to ring pattern: ${ringPattern}`);
        this.log.info(`FMD adapter ready. Server: ${config.serverUrl}`);
        // Run the actual login + device fetch in the background so the
        // adapter reaches "ready" quickly. Before this fix, onReady
        // created the FmdAuth object but never called authenticate(),
        // so no API call ever happened and no device states were
        // created under 0_userdata.0.FindMyDevice.*.
        this.connectAndFetchDevices().catch((err) => {
            this.log.error(`Background connect/fetch failed: ${err}`);
            this.setConnectionStatus("error", String(err));
        });
    }
    /**
     * Run the FMD auth + device fetch in the background.
     * Called from onReady after the synchronous setup is done.
     */
    async connectAndFetchDevices() {
        if (!this.fmdAuth)
            return;
        const config = this.config;
        this.setConnectionStatus("connecting");
        try {
            const tokens = await this.fmdAuth.authenticate();
            this.authTokens = tokens;
            this.fmdApi = new fmd_api_1.FmdApi({
                serverUrl: config.serverUrl,
                authTokens: tokens,
                log: this.log,
            });
            await this.fetchDevices();
            this.setConnectionStatus("connected");
        }
        catch (err) {
            this.log.error(`FMD connect failed: ${err}`);
            this.setConnectionStatus("error", String(err));
            throw err;
        }
    }
    /**
     * Subscribe to button state for hardware trigger.
     *
     * If the user has set `buttonStateId` in the native config, use
     * that; otherwise fall back to the hardcoded Shelly button from
     * the project's vision (used by the original developer). This
     * means the schema field added in the OpenSpec change
     * add-admin-ui-index-html finally does something for users who
     * configure it.
     */
    subscribeToButtonState() {
        const config = this.config;
        const buttonId = config.buttonStateId && config.buttonStateId.length > 0
            ? config.buttonStateId
            : this.BUTTON_STATE_ID;
        this.subscribeStates(buttonId);
        this.log.info(`Subscribed to button state: ${buttonId}`);
    }
    /**
     * Initialize connection status states in ioBroker
     */
    async initConnectionStates() {
        await this.setObjectNotExistsAsync("info.connection", {
            type: "state",
            common: {
                name: "FMD server connection status",
                type: "string",
                role: "indicator.reachable",
                read: true,
                write: false,
                def: "disconnected",
            },
            native: {},
        });
        await this.setObjectNotExistsAsync("info.lastError", {
            type: "state",
            common: {
                name: "Last connection error",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "",
            },
            native: {},
        });
        // Set initial connection status
        await this.setStateAsync("info.connection", "disconnected", true);
    }
    /**
     * Set and broadcast connection status
     */
    setConnectionStatus(status, errorMsg) {
        this.connectionStatus = status;
        this.setStateAsync("info.connection", status, true);
        if (errorMsg) {
            this.setStateAsync("info.lastError", errorMsg, true);
        }
        this.log.info(`FMD connection status: ${status}`);
    }
    /**
     * Fetch devices from FMD server and create states
     */
    async fetchDevices() {
        if (!this.fmdAuth) {
            throw new Error("FMD auth not initialized");
        }
        // Lazy authentication
        if (!this.authTokens) {
            this.authTokens = await this.fmdAuth.authenticate();
        }
        // Create FMD API instance
        this.fmdApi = new fmd_api_1.FmdApi({
            serverUrl: this.fmdAuth.getServerUrl(),
            authTokens: this.authTokens,
            log: this.log,
        });
        // Fetch devices
        const devices = await this.fmdApi.listDevices();
        this.devices.clear();
        for (const device of devices) {
            this.devices.set(device.id, device);
            await this.createDeviceStates(device);
        }
        this.log.info(`Fetched ${devices.length} devices`);
    }
    /**
     * Create states for a device
     */
    async createDeviceStates(device) {
        // Create device info under fmd.0.devices.<deviceId>
        await this.setObjectNotExistsAsync(`devices.${device.id}`, {
            type: "channel",
            common: {
                name: device.name,
            },
            native: {},
        });
        await this.setObjectNotExistsAsync(`devices.${device.id}.name`, {
            type: "state",
            common: {
                name: "Device name",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: device.name,
            },
            native: {},
        });
        await this.setObjectNotExistsAsync(`devices.${device.id}.type`, {
            type: "state",
            common: {
                name: "Device type",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: device.type,
            },
            native: {},
        });
        await this.setObjectNotExistsAsync(`devices.${device.id}.lastRing`, {
            type: "state",
            common: {
                name: "Last ring timestamp",
                type: "number",
                role: "value.time",
                read: true,
                write: false,
                def: 0,
            },
            native: {},
        });
        // Create ring state under 0_userdata.0.FindMyDevice.ring.<deviceId>
        await this.setObjectNotExistsAsync("0_userdata.0.FindMyDevice.ring." + device.id, {
            type: "state",
            common: {
                name: `Ring ${device.name}`,
                type: "boolean",
                role: "button",
                read: true,
                write: true,
                def: false,
            },
            native: {},
        });
        // Set device name in userdata
        await this.setObjectNotExistsAsync("0_userdata.0.FindMyDevice.devices." + device.id + ".name", {
            type: "state",
            common: {
                name: "Device name",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: device.name,
            },
            native: {},
        });
        // Set device type in userdata
        await this.setObjectNotExistsAsync("0_userdata.0.FindMyDevice.devices." + device.id + ".type", {
            type: "state",
            common: {
                name: "Device type",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: device.type,
            },
            native: {},
        });
    }
    /**
     * Get device by ID
     */
    getDevice(deviceId) {
        return this.devices.get(deviceId);
    }
    /**
     * Get all devices
     */
    getAllDevices() {
        return Array.from(this.devices.values());
    }
    /**
     * Called when a subscribed state changes
     */
    async onStateChange(id, state) {
        // TEMP DEBUG: log every state change at info level to diagnose
        // why 0_userdata.0.FindMyDevice.ring.* is not firing. Will be
        // reverted to debug once we know what's happening.
        this.log.info(`[onStateChange] id=${id} val=${state?.val} ack=${state?.ack}`);
        if (!state || state.ack) {
            this.log.info(`[onStateChange] filtered out (state=${!!state}, ack=${state?.ack})`);
            return;
        }
        // Handle button trigger. Compare against the configured
        // buttonStateId if set, otherwise fall back to the hardcoded
        // Shelly button from the project's vision.
        const config = this.config;
        const buttonId = config.buttonStateId && config.buttonStateId.length > 0
            ? config.buttonStateId
            : this.BUTTON_STATE_ID;
        if (id === buttonId && state.val === this.BUTTON_TRIGGER) {
            this.log.info("Button triple_push detected, triggering ring");
            if (config.ringDeviceId) {
                await this.triggerRing(config.ringDeviceId);
            }
            else {
                this.log.warn("No ring device configured");
            }
        }
        // Handle ring state changes in 0_userdata.0.FindMyDevice.ring.<deviceId>
        const ringMatch = id.match(/^0_userdata\.0\.FindMyDevice\.ring\.(.+)$/);
        if (ringMatch && state.val === true) {
            const deviceId = ringMatch[1];
            this.log.info(`Ring state triggered for device: ${deviceId}`);
            await this.triggerRing(deviceId);
        }
    }
    /**
     * Trigger ring for a device
     */
    async triggerRing(deviceId) {
        if (!this.fmdApi) {
            try {
                await this.fetchDevices();
            }
            catch (err) {
                this.log.error(`Failed to fetch devices: ${err}`);
                return;
            }
        }
        try {
            await this.fmdApi.sendRingCommand(deviceId);
            // Update lastRing timestamp
            const device = this.getDevice(deviceId);
            if (device) {
                device.lastRing = Date.now();
                await this.setStateAsync(`devices.${deviceId}.lastRing`, device.lastRing, true);
            }
            // Reset ring state to false
            await this.setStateAsync("0_userdata.0.FindMyDevice.ring." + deviceId, false, true);
        }
        catch (err) {
            this.log.error(`Failed to ring device ${deviceId}: ${err}`);
        }
    }
    /**
     * Called when adapter receives a message
     */
    async onMessage(obj) {
        if (!obj.command)
            return;
        this.log.debug(`Message received: ${obj.command}`);
        switch (obj.command) {
            case "testConnection":
                await this.testConnection(obj);
                break;
            case "ring":
                await this.sendRingCommand(obj);
                break;
            case "getDevices":
                await this.getDevicesHandler(obj);
                break;
            default:
                this.log.warn(`Unknown command: ${obj.command}`);
        }
    }
    /**
     * Test FMD server connection
     */
    async testConnection(obj) {
        if (!this.fmdAuth) {
            this.sendTo(obj.from, obj.command, { error: "FMD not initialized" }, obj.callback);
            return;
        }
        this.setConnectionStatus("connecting");
        try {
            const tokens = await this.fmdAuth.authenticate();
            this.authTokens = tokens;
            // Create API instance
            this.fmdApi = new fmd_api_1.FmdApi({
                serverUrl: this.fmdAuth.getServerUrl(),
                authTokens: this.authTokens,
                log: this.log,
            });
            // Fetch devices to verify connection
            await this.fmdApi.listDevices();
            this.setConnectionStatus("connected");
            this.sendTo(obj.from, obj.command, { success: true, message: "Connected successfully" }, obj.callback);
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.setConnectionStatus("error", errorMsg);
            this.log.error(`Connection test failed: ${errorMsg}`);
            this.sendTo(obj.from, obj.command, { error: errorMsg }, obj.callback);
        }
    }
    /**
     * Get devices handler
     */
    async getDevicesHandler(obj) {
        try {
            if (!this.devices.size) {
                await this.fetchDevices();
            }
            this.sendTo(obj.from, obj.command, { success: true, devices: this.getAllDevices() }, obj.callback);
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.sendTo(obj.from, obj.command, { error: errorMsg }, obj.callback);
        }
    }
    /**
     * Send ring command to FMD server
     */
    async sendRingCommand(obj) {
        if (!this.fmdAuth) {
            this.sendTo(obj.from, obj.command, { error: "FMD not initialized" }, obj.callback);
            return;
        }
        const deviceId = obj.message?.deviceId || obj.message;
        if (!deviceId) {
            this.sendTo(obj.from, obj.command, { error: "No deviceId provided" }, obj.callback);
            return;
        }
        // Lazy authentication and API initialization
        if (!this.authTokens) {
            try {
                this.authTokens = await this.fmdAuth.authenticate();
                this.setConnectionStatus("connected");
            }
            catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                this.setConnectionStatus("error", errorMsg);
                this.sendTo(obj.from, obj.command, { error: errorMsg }, obj.callback);
                return;
            }
        }
        if (!this.fmdApi) {
            this.fmdApi = new fmd_api_1.FmdApi({
                serverUrl: this.fmdAuth.getServerUrl(),
                authTokens: this.authTokens,
                log: this.log,
            });
        }
        try {
            await this.fmdApi.sendRingCommand(deviceId);
            // Update lastRing
            const device = this.getDevice(deviceId);
            if (device) {
                device.lastRing = Date.now();
            }
            this.sendTo(obj.from, obj.command, { success: true, message: `Ring command sent to ${deviceId}` }, obj.callback);
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.sendTo(obj.from, obj.command, { error: errorMsg }, obj.callback);
        }
    }
    /**
     * Called when adapter is stopped
     */
    onUnload(callback) {
        this.log.info("FMD adapter unloading...");
        this.devices.clear();
        this.authTokens = undefined;
        this.fmdAuth = undefined;
        this.fmdApi = undefined;
        callback();
    }
}
module.exports = new FmdAdapter();
//# sourceMappingURL=main.js.map