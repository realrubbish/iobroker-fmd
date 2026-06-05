import * as utils from "@iobroker/adapter-core";
import { FmdAuth, AuthTokens } from "./lib/fmd-auth";
import { FmdApi, FmdDevice } from "./lib/fmd-api";

/**
 * FMD Adapter configuration interface
 * These properties come from io-package.json native section
 */
interface FmdNativeConfig {
    serverUrl: string;
    username: string;
    password: string;
    buttonStateId?: string;
    ringDeviceId?: string;
}

/**
 * FMD Adapter for ioBroker
 * Rings FMD devices via ntfy push notifications
 */
class FmdAdapter extends utils.Adapter {
    private fmdAuth?: FmdAuth;
    private fmdApi?: FmdApi;
    private authTokens?: AuthTokens;
    private connectionStatus: "disconnected" | "connecting" | "connected" | "error" = "disconnected";
    private devices: Map<string, FmdDevice> = new Map();

    // Hardcoded button trigger state ID from vision.md
    private readonly BUTTON_STATE_ID = "shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event";
    private readonly BUTTON_TRIGGER = "triple_push";

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: "fmd",
        });

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.on("message", this.onMessage.bind(this));
    }

    /**
     * Called when adapter is initialized
     */
    private async onReady(): Promise<void> {
        this.log.info("FMD adapter starting...");

        // Initialize connection status states
        await this.initConnectionStates();

        // Get config with proper typing - ioBroker stores in native
        const config = this.config as FmdNativeConfig;

        // Check if configuration is present
        if (!config.serverUrl || !config.username || !config.password) {
            this.log.warn("FMD configuration incomplete. Please set server URL, username, and password.");
            this.setConnectionStatus("disconnected");
            return;
        }

        // Initialize FMD Auth module
        this.fmdAuth = new FmdAuth({
            serverUrl: config.serverUrl,
            username: config.username,
            password: config.password,
            log: this.log,
        });

        // Subscribe to button state for hardware trigger
        this.subscribeToButtonState();

        this.log.info(`FMD adapter ready. Server: ${config.serverUrl}`);
    }

    /**
     * Subscribe to button state for hardware trigger
     */
    private subscribeToButtonState(): void {
        this.subscribeStates(this.BUTTON_STATE_ID);
        this.log.info(`Subscribed to button state: ${this.BUTTON_STATE_ID}`);
    }

    /**
     * Initialize connection status states in ioBroker
     */
    private async initConnectionStates(): Promise<void> {
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
    private setConnectionStatus(status: "disconnected" | "connecting" | "connected" | "error", errorMsg?: string): void {
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
    private async fetchDevices(): Promise<void> {
        if (!this.fmdAuth) {
            throw new Error("FMD auth not initialized");
        }

        // Lazy authentication
        if (!this.authTokens) {
            this.authTokens = await this.fmdAuth.authenticate();
        }

        // Create FMD API instance
        this.fmdApi = new FmdApi({
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
    private async createDeviceStates(device: FmdDevice): Promise<void> {
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
    private getDevice(deviceId: string): FmdDevice | undefined {
        return this.devices.get(deviceId);
    }

    /**
     * Get all devices
     */
    private getAllDevices(): FmdDevice[] {
        return Array.from(this.devices.values());
    }

    /**
     * Called when a subscribed state changes
     */
    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!state || state.ack) return;

        this.log.debug(`State change: ${id} = ${state.val}`);

        // Handle button trigger
        if (id === this.BUTTON_STATE_ID && state.val === this.BUTTON_TRIGGER) {
            this.log.info("Button triple_push detected, triggering ring");
            const config = this.config as FmdNativeConfig;
            if (config.ringDeviceId) {
                await this.triggerRing(config.ringDeviceId);
            } else {
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
    private async triggerRing(deviceId: string): Promise<void> {
        if (!this.fmdApi) {
            try {
                await this.fetchDevices();
            } catch (err) {
                this.log.error(`Failed to fetch devices: ${err}`);
                return;
            }
        }

        try {
            await this.fmdApi!.sendRingCommand(deviceId);

            // Update lastRing timestamp
            const device = this.getDevice(deviceId);
            if (device) {
                device.lastRing = Date.now();
                await this.setStateAsync(`devices.${deviceId}.lastRing`, device.lastRing, true);
            }

            // Reset ring state to false
            await this.setStateAsync("0_userdata.0.FindMyDevice.ring." + deviceId, false, true);
        } catch (err) {
            this.log.error(`Failed to ring device ${deviceId}: ${err}`);
        }
    }

    /**
     * Called when adapter receives a message
     */
    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj.command) return;

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
    private async testConnection(obj: ioBroker.Message): Promise<void> {
        if (!this.fmdAuth) {
            this.sendTo(obj.from, obj.command, { error: "FMD not initialized" }, obj.callback);
            return;
        }

        this.setConnectionStatus("connecting");

        try {
            const tokens = await this.fmdAuth.authenticate();
            this.authTokens = tokens;

            // Create API instance
            this.fmdApi = new FmdApi({
                serverUrl: this.fmdAuth.getServerUrl(),
                authTokens: this.authTokens,
                log: this.log,
            });

            // Fetch devices to verify connection
            await this.fmdApi.listDevices();

            this.setConnectionStatus("connected");
            this.sendTo(obj.from, obj.command, { success: true, message: "Connected successfully" }, obj.callback);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.setConnectionStatus("error", errorMsg);
            this.log.error(`Connection test failed: ${errorMsg}`);
            this.sendTo(obj.from, obj.command, { error: errorMsg }, obj.callback);
        }
    }

    /**
     * Get devices handler
     */
    private async getDevicesHandler(obj: ioBroker.Message): Promise<void> {
        try {
            if (!this.devices.size) {
                await this.fetchDevices();
            }
            this.sendTo(obj.from, obj.command, { success: true, devices: this.getAllDevices() }, obj.callback);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.sendTo(obj.from, obj.command, { error: errorMsg }, obj.callback);
        }
    }

    /**
     * Send ring command to FMD server
     */
    private async sendRingCommand(obj: ioBroker.Message): Promise<void> {
        if (!this.fmdAuth) {
            this.sendTo(obj.from, obj.command, { error: "FMD not initialized" }, obj.callback);
            return;
        }

        const deviceId = obj.message?.deviceId || (obj.message as string);
        if (!deviceId) {
            this.sendTo(obj.from, obj.command, { error: "No deviceId provided" }, obj.callback);
            return;
        }

        // Lazy authentication and API initialization
        if (!this.authTokens) {
            try {
                this.authTokens = await this.fmdAuth.authenticate();
                this.setConnectionStatus("connected");
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                this.setConnectionStatus("error", errorMsg);
                this.sendTo(obj.from, obj.command, { error: errorMsg }, obj.callback);
                return;
            }
        }

        if (!this.fmdApi) {
            this.fmdApi = new FmdApi({
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
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.sendTo(obj.from, obj.command, { error: errorMsg }, obj.callback);
        }
    }

    /**
     * Called when adapter is stopped
     */
    private onUnload(callback: () => void): void {
        this.log.info("FMD adapter unloading...");
        this.devices.clear();
        this.authTokens = undefined;
        this.fmdAuth = undefined;
        this.fmdApi = undefined;
        callback();
    }
}

// Export adapter instance
export = new FmdAdapter();
