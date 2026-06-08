import * as utils from "@iobroker/adapter-core";
/**
 * FMD Adapter for ioBroker
 * Rings FMD devices via ntfy push notifications
 */
declare class FmdAdapter extends utils.Adapter {
    private fmdAuth?;
    private fmdApi?;
    private authTokens?;
    private connectionStatus;
    private devices;
    private readonly BUTTON_STATE_ID;
    private readonly BUTTON_TRIGGER;
    constructor(options?: Partial<utils.AdapterOptions>);
    /**
     * Called when adapter is initialized
     */
    private onReady;
    /**
     * Run the FMD auth + device fetch in the background.
     * Called from onReady after the synchronous setup is done.
     */
    private connectAndFetchDevices;
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
    private subscribeToButtonState;
    /**
     * Initialize connection status states in ioBroker
     */
    private initConnectionStates;
    /**
     * Set and broadcast connection status
     */
    private setConnectionStatus;
    /**
     * Fetch devices from FMD server and create states
     */
    private fetchDevices;
    /**
     * Create states for a device
     */
    private createDeviceStates;
    /**
     * Get device by ID
     */
    private getDevice;
    /**
     * Get all devices
     */
    private getAllDevices;
    /**
     * Called when a subscribed state changes
     */
    private onStateChange;
    /**
     * Trigger ring for a device
     */
    private triggerRing;
    /**
     * Called when adapter receives a message
     */
    private onMessage;
    /**
     * Test FMD server connection
     */
    private testConnection;
    /**
     * Get devices handler
     */
    private getDevicesHandler;
    /**
     * Send ring command to FMD server
     */
    private sendRingCommand;
    /**
     * Called when adapter is stopped
     */
    private onUnload;
}
declare const _default: FmdAdapter;
export = _default;
//# sourceMappingURL=main.d.ts.map