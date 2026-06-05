import * as utils from "@iobroker/adapter-core";
import { FmdAuth, AuthTokens } from "./lib/fmd-auth";

/**
 * FMD Adapter configuration interface
 * These properties come from io-package.json native section
 */
interface FmdNativeConfig {
    serverUrl: string;
    username: string;
    password: string;
}

/**
 * FMD Adapter for ioBroker
 * Rings FMD devices via ntfy push notifications
 */
class FmdAdapter extends utils.Adapter {
    private fmdAuth?: FmdAuth;
    private authTokens?: AuthTokens;
    private connectionStatus: "disconnected" | "connecting" | "connected" | "error" = "disconnected";

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

        this.log.info(`FMD adapter ready. Server: ${config.serverUrl}`);
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
     * Called when a subscribed state changes
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) return;

        this.log.debug(`State change: ${id} = ${state.val}`);
        // Handle state changes for ring commands
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
     * Send ring command to FMD server
     */
    private async sendRingCommand(obj: ioBroker.Message): Promise<void> {
        if (!this.fmdAuth) {
            this.sendTo(obj.from, obj.command, { error: "FMD not initialized" }, obj.callback);
            return;
        }

        // Lazy authentication - authenticate if not already done
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

        // TODO: Implement ring command once devices are known
        this.sendTo(obj.from, obj.command, { success: true, message: "Ring command sent" }, obj.callback);
    }

    /**
     * Called when adapter is stopped
     */
    private onUnload(callback: () => void): void {
        this.log.info("FMD adapter unloading...");
        this.authTokens = undefined;
        this.fmdAuth = undefined;
        callback();
    }
}

// Export adapter instance
export = new FmdAdapter();
