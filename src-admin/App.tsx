/**
 * App.tsx — mounts the JsonConfig component from @iobroker/json-config
 * with the adapter's jsonConfig.json5 schema and a live adapter socket.
 *
 * Live polling (Tasks 4.3–4.5 of the OpenSpec change
 * add-admin-ui-index-html) is implemented here:
 *  - 5-second interval reads info.connection and info.lastError and
 *    pushes the values into the `data` prop under the keys
 *    `connectionState` and `lastError` that jsonConfig.json5 references.
 *  - The Devices panel re-reads `0_userdata.0.FindMyDevice.ring.*` on
 *    the same interval and renders a plain-text list of the IDs.
 *  - Save is handled by JsonConfig's built-in native-config flow; we
 *    only need to seed `data` with the existing config on mount.
 *
 * Test Connection (add-test-connection-button):
 *  - We render the button as a real React `<button>` outside the
 *    JsonConfig widget tree, because `JsonConfig`'s built-in
 *    `type: "sendTo"` widget surfaces the reply via `window.alert` and
 *    has no callback hook to feed our `testResult` staticText line.
 *  - The reply is shaped `{ success, message }` or `{ error }` — see
 *    `src/main.ts` `onMessage.testConnection`. We format it as
 *    "OK – connected at HH:MM:SS" / "Failed – <reason> at HH:MM:SS".
 *  - The 5s poll loop clears a stale "OK" line on a fresh
 *    `info.lastError` (see D3 step 4 of the design).
 */
import React from "react";
import { JsonConfig } from "@iobroker/json-config";
import { I18n, type IobTheme } from "@iobroker/adapter-react-v5";
import jsonConfigSchema from "./schema.json5";
import { createAdapterSocket, type AdapterSocket } from "./socket";

const POLL_INTERVAL_MS = 5_000;
const TEST_RESULT_PLACEHOLDER = "(click Test Connection to run)";

interface AppProps {
    adapterName: string;
    instance: number;
    themeName: IobTheme["name"];
    themeType: IobTheme["themeType"];
}

interface TestConnectionReply {
    success?: boolean;
    message?: string;
    error?: string;
}

export default function App({ adapterName, instance, themeName, themeType }: AppProps) {
    const [socket] = React.useState<AdapterSocket>(() =>
        createAdapterSocket(adapterName, instance),
    );

    // We hold the JsonConfig `data` as a plain object and let JsonConfig
    // call `updateData` whenever the user changes a field. Live panels
    // (status + devices) overwrite their own keys on each poll.
    const [data, setData] = React.useState<Record<string, unknown>>({});
    const [testResult, setTestResult] = React.useState<string>(TEST_RESULT_PLACEHOLDER);
    const [testRunning, setTestRunning] = React.useState<boolean>(false);
    const [deviceList, setDeviceList] = React.useState<string>("(loading…)");

    // Track the last observed lastError value so the poll loop can
    // detect a fresh empty→non-empty transition and clear a stale "OK"
    // testResult line (D3 step 4).
    const lastErrorRef = React.useRef<string | null>(null);

    // Seed: load the existing native config and the initial connection
    // status. The form becomes editable from the first paint.
    React.useEffect(() => {
        if (!socket.isLive) return;
        let cancelled = false;
        (async () => {
            const cfg = await socket.getAdapterConfig(adapterName, instance);
            if (!cancelled) setData((prev) => ({ ...prev, ...cfg }));
        })().catch((err) => {
            // eslint-disable-next-line no-console
            console.warn("[iobroker-fmd] could not load existing config:", err);
        });
        return () => {
            cancelled = true;
        };
    }, [adapterName, instance, socket]);

    // Live polling: every 5s, refresh status + devices. We use a single
    // interval to keep the load on the controller predictable. Polling
    // stops when the iframe unmounts.
    React.useEffect(() => {
        if (!socket.isLive) return;
        let cancelled = false;

        async function poll() {
            try {
                // Status panel: info.connection + info.lastError
                const infoStates = await socket.getStates([
                    `system.adapter.${adapterName}.${instance}.info.connection`,
                    `system.adapter.${adapterName}.${instance}.info.lastError`,
                ]);
                const conn = infoStates[`system.adapter.${adapterName}.${instance}.info.connection`];
                const err = infoStates[`system.adapter.${adapterName}.${instance}.info.lastError`];
                if (cancelled) return;
                const errVal = err ? (typeof err.val === "string" ? err.val : null) : null;
                // Fresh error transition: clear a stale "OK" line so the
                // user is not misled by a successful test from minutes
                // ago while the live state is now failing.
                if (errVal && errVal.length > 0 && lastErrorRef.current !== errVal) {
                    setTestResult(TEST_RESULT_PLACEHOLDER);
                }
                lastErrorRef.current = errVal;
                setData((prev) => ({
                    ...prev,
                    connectionState: {
                        val: conn ? conn.val === true : false,
                        display: conn
                            ? conn.val === true
                                ? "connected"
                                : "disconnected"
                            : "unknown",
                    },
                    lastError: { val: errVal },
                }));

                // Devices panel: list of ring state IDs
                const ringStates = await socket.getStates("0_userdata.0.FindMyDevice.ring.*");
                if (cancelled) return;
                const ids = Object.keys(ringStates)
                    .map((id) => id.split(".").pop() || "")
                    .filter(Boolean);
                setDeviceList(
                    ids.length > 0
                        ? ids.map((id) => `• ${id} (val=${JSON.stringify(ringStates[`0_userdata.0.FindMyDevice.ring.${id}`]?.val)})`).join("\n")
                        : "(no ring states configured — create 0_userdata.0.FindMyDevice.ring.<deviceId>)",
                );
            } catch (err) {
                if (cancelled) return;
                // eslint-disable-next-line no-console
                console.warn("[iobroker-fmd] poll failed:", err);
            }
        }

        poll();
        const handle = globalThis.setInterval(poll, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            globalThis.clearInterval(handle);
        };
    }, [adapterName, instance, socket]);

    // Handle the Test Connection button click. We do not use
    // JsonConfig's `type: "sendTo"` widget (it shows the reply via
    // `window.alert` and has no callback), so we wire the call to
    // `socket.sendTo` ourselves and format the reply for the
    // `Last Test Result` staticText line in the status panel.
    const handleTestConnection = React.useCallback(async () => {
        if (!socket.isLive || testRunning) return;
        setTestRunning(true);
        const now = new Date().toLocaleTimeString();
        try {
            const reply = (await socket.sendTo(
                `${adapterName}.${instance}`,
                "testConnection",
                {},
            )) as TestConnectionReply | null;
            if (reply && reply.error) {
                setTestResult(`Failed – ${reply.error} at ${now}`);
            } else if (reply && reply.success) {
                setTestResult(`OK – connected at ${now}`);
            } else {
                // Unexpected shape: surface whatever the adapter sent so
                // the user (and we) can debug.
                setTestResult(`Failed – unexpected reply at ${now}`);
            }
        } catch (err) {
            setTestResult(`Failed – ${err instanceof Error ? err.message : String(err)} at ${now}`);
        } finally {
            setTestRunning(false);
        }
    }, [adapterName, instance, socket, testRunning]);

    // Build a minimal IobTheme. The host admin already styles the iframe
    // parent; JsonConfig only needs the name/type fields to be valid.
    const theme: IobTheme = React.useMemo(
        () =>
            ({
                name: themeName,
                themeType,
                themeName,
                theme: {} as never,
            }) as unknown as IobTheme,
        [themeName, themeType],
    );

    return (
        <div style={{ padding: 16, fontFamily: "sans-serif" }}>
            <JsonConfig
                socket={socket as never}
                adapterName={adapterName}
                instance={instance}
                isFloatComma
                dateFormat="dd.mm.yyyy"
                secret={`${adapterName}.${instance}`}
                theme={theme}
                themeName={themeName}
                themeType={themeType}
                t={I18n.t.bind(I18n) as typeof I18n.t}
                width="lg"
                configStored={() => {
                    // JsonConfig has just persisted the form. The host
                    // admin handles the adapter restart on its end; we
                    // do not need to call anything explicitly.
                }}
                customComponents={{}}
                data={{
                    ...data,
                    deviceList: { val: deviceList },
                    testResult: { val: testResult },
                }}
                updateData={(newData) =>
                    setData((prev) => ({ ...prev, ...newData }))
                }
                onError={(err) => {
                    // eslint-disable-next-line no-console
                    console.error("[iobroker-fmd] JsonConfig error:", err);
                }}
                schema={jsonConfigSchema as never}
            />
            {/* Visible Test Connection button — rendered here (not as
                a JsonConfig `type: "sendTo"` item) so we can format the
                reply into the `testResult` staticText line with a
                timestamp. */}
            <div style={{ marginTop: 12 }}>
                <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={!socket.isLive || testRunning}
                    aria-live="polite"
                    style={{
                        padding: "6px 14px",
                        fontSize: 14,
                        cursor: testRunning ? "wait" : "pointer",
                    }}
                >
                    {testRunning ? "Testing…" : "Test Connection"}
                </button>
            </div>
            {!socket.isLive && (
                <p style={{ color: "#a00", marginTop: 12 }}>
                    Live data unavailable: the host admin's <code>socket.io.js</code> did not load.
                    The form below is read-only.
                </p>
            )}
        </div>
    );
}
