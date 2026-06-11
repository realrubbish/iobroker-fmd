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
 * Ring Device (add-ring-button-in-admin-pop-up):
 *  - The PRIMARY entry point is the `type: "sendTo"` schema item in
 *    the Status panel of `schema.json5`. ioBroker.admin's native
 *    jsonConfig renderer (the surface admin 7.7.22 actually shows in
 *    the wrench pop-up — see `docs/admin-ui.md` §"Known limitation")
 *    renders that item as a button backed by the `ConfigSendTo` widget
 *    and displays the reply via `window.alert`. The widget passes
 *    `payload = { deviceId: <configured ringDeviceId> }` to the adapter.
 *  - This file's `handleRingDevice` and the visible `<button>` we
 *    render below the JsonConfig widget are the FALLBACK path for
 *    admin versions that load the Vite-SPA iframe. They mirror the
 *    same `socket.sendTo("ring", { deviceId })` call and surface the
 *    reply via the same `window.alert` (the iframe path is a no-op
 *    for the native form, so the custom button only renders when the
 *    schema item is gone). The 12-second `Promise.race` timeout
 *    protects against a hung adapter. They are gated on
 *    `!hasSchemaRingNow` so the user never sees two buttons.
 *  - The reply is shaped `{ success, message }` or `{ error }` — see
 *    `src/main.ts` `onMessage.ring`.
 */
import React from "react";
import { JsonConfig } from "@iobroker/json-config";
import { I18n, type IobTheme } from "@iobroker/adapter-react-v5";
import jsonConfigSchema from "./schema.json5";
import { createAdapterSocket, type AdapterSocket } from "./socket";

const POLL_INTERVAL_MS = 5_000;

// 12 s budget for the Ring Device round-trip. Generous enough to
// cover Pi-class hardware (Argon2id × 2 + 2× HTTP round-trip +
// AES-GCM unwrap + buffer + ring dispatch) with a ~2× safety margin
// over the dev-host worst-case (~3-5 s on a Pi, 600-800 ms on macOS
// M-series). On timeout, the button re-enables itself and a
// `window.alert` surfaces the failure so a hung adapter does not
// strand the UI.
const RING_DEVICE_TIMEOUT_MS = 12_000;

// Detect whether the schema declares a `type: "sendTo"` Ring Device
// item. If it does, the native jsonConfig renderer (the surface
// ioBroker.admin 7.7.22 actually shows) renders the button itself, and
// our own custom `<button>` below would double-render alongside it.
// The check is constant for the lifetime of the app — schema is a
// module-level import — so we compute it once at module load.
const hasSchemaRingNow: boolean = (() => {
    const items = (jsonConfigSchema as { items?: Record<string, unknown> }).items;
    // eslint-disable-next-line no-console
    console.log("[iobroker-fmd DIAG] hasSchemaRingNow check:", {
        hasItems: !!items,
        itemsType: typeof items,
        itemsKeys: items && typeof items === "object" ? Object.keys(items) : null,
        probe: "jsonConfigSchema.items.status.items.ringNow.type === 'sendTo'",
    });
    if (!items || typeof items !== "object") return false;
    const status = (items as Record<string, unknown>)["status"];
    if (!status || typeof status !== "object") return false;
    const statusItems = (status as { items?: Record<string, unknown> }).items;
    if (!statusItems || typeof statusItems !== "object") return false;
    const ring = (statusItems as Record<string, unknown>)["ringNow"];
    return !!ring && typeof ring === "object" && (ring as { type?: string }).type === "sendTo";
})();

interface AppProps {
    adapterName: string;
    instance: number;
    themeName: IobTheme["name"];
    themeType: IobTheme["themeType"];
}

interface RingDeviceReply {
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
    const [ringRunning, setRingRunning] = React.useState<boolean>(false);
    const [deviceList, setDeviceList] = React.useState<string>("(loading…)");

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
                // Note: only `val` here. We do NOT push a `display` key
                // into the `connectionState` `staticText` field because
                // the @iobroker/json-config schema validator rejects
                // unknown properties on staticText items, and a single
                // invalid key in the Status panel causes the admin SPA
                // to skip the whole panel (so the `Ring Device`
                // button we ship would not render either). The
                // boolean `val` is rendered as a checkbox-style
                // "true"/"false" by the staticText widget; that is
                // good enough for a status indicator and keeps the
                // schema valid.
                setData((prev) => ({
                    ...prev,
                    connectionState: { val: conn ? conn.val === true : false },
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

    // Handle the Ring Device button click. This handler is the
    // fallback path — see the contract in the file header. The primary
    // path on admin 7.7.22 is the `type: "sendTo"` schema item, which
    // calls `socket.sendTo("ring", { deviceId })` itself and shows the
    // reply via `window.alert`. We mirror the same call here for
    // future admin versions that take the iframe path AND that have
    // been forked to remove the `type: "sendTo"` schema item, and
    // surface the reply the same way the native form would.
    const handleRingDevice = React.useCallback(async () => {
        if (!socket.isLive || ringRunning) return;
        setRingRunning(true);
        // Read the configured deviceId from the form data the JsonConfig
        // already populated from `system.adapter.iobroker-fmd.0.native`
        // (see the seed effect at the top of this component). The
        // adapter-runtime is the source of truth for the live value;
        // we only read what the SPA was given on mount. An empty
        // deviceId is passed through to the adapter-runtime, which
        // replies with an error that we surface via `window.alert`.
        const ringDeviceId = typeof data["ringDeviceId"] === "string" ? (data["ringDeviceId"] as string) : "";
        // Client-side timeout so a hung adapter cannot strand the
        // button in "Ringing…" forever. The timeout-rejection
        // propagates to the catch arm below; the finally arm
        // re-enables the button. Tagged with a recognizable message
        // for the catch-arm branch to detect (vs an arbitrary
        // network error).
        const timeoutMs = RING_DEVICE_TIMEOUT_MS;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(
                () => reject(new Error("ring timeout")),
                timeoutMs,
            );
        });
        try {
            const reply = (await Promise.race([
                socket.sendTo(
                    `${adapterName}.${instance}`,
                    "ring",
                    { deviceId: ringDeviceId },
                ),
                timeoutPromise,
            ])) as RingDeviceReply | null;
            if (reply && reply.error) {
                window.alert(`Ring Device failed: ${reply.error}`);
            } else if (reply && reply.success) {
                window.alert(`Ring Device: ${reply.message || "ok"}`);
            } else {
                window.alert("Ring Device: unexpected reply");
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message === "ring timeout") {
                // eslint-disable-next-line no-console
                console.warn(`[iobroker-fmd] Ring Device timed out after ${timeoutMs}ms`);
                window.alert(`Ring Device timed out after ${timeoutMs / 1000}s`);
            } else {
                window.alert(`Ring Device failed: ${message}`);
            }
        } finally {
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
            setRingRunning(false);
        }
    }, [adapterName, instance, socket, ringRunning, data]);

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
            {/*
                The custom button is a fallback for future admin versions
                that take the iframe path AND that have been forked to
                remove the `type: "sendTo"` schema item. The main path is
                the schema item, which is rendered in both the native
                form (admin 7.7.22) and the iframe path. We gate the
                custom button on `!hasSchemaRingNow` so the user never
                sees two buttons.
            */}
            {!hasSchemaRingNow && (
                <div style={{ marginTop: 12 }}>
                    <button
                        type="button"
                        onClick={handleRingDevice}
                        disabled={!socket.isLive || ringRunning}
                        aria-live="polite"
                        style={{
                            padding: "6px 14px",
                            fontSize: 14,
                            cursor: ringRunning ? "wait" : "pointer",
                        }}
                    >
                        {ringRunning ? "Ringing…" : "Ring Device"}
                    </button>
                </div>
            )}
            {!socket.isLive && (
                <p style={{ color: "#a00", marginTop: 12 }}>
                    Live data unavailable: the host admin's <code>socket.io.js</code> did not load.
                    The form below is read-only.
                </p>
            )}
        </div>
    );
}
