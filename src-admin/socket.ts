/**
 * Adapter-socket wrapper.
 *
 * The host ioBroker.admin bundle ships its own minimal Socket.IO client at
 * /adapter/iobroker/admin/lib/js/socket.io.js. That script attaches a
 * `window.io = { connect: connect }` global; `connect()` returns a
 * `SocketClient` instance. The `JsonConfig` component (and the wider
 * ioBroker admin UI) expects an object that exposes the same surface as
 * `@iobroker/socket-client`'s `Connection` class — `getStates`, `getState`,
 * `setObject`, `sendTo`, `subscribeState`, `getObject`, `setState`, and a
 * few more — and uses the host's auth context.
 *
 * Why we do not use `@iobroker/socket-client`'s `AdminConnection` directly:
 * that class wires its own `socket.io-client` to a host:port pair and
 * requires explicit credentials. Inside a nested iframe, we have neither —
 * the host admin has already authenticated the browser session, and the
 * `window.io` global is exactly the bridge that lets an iframe reuse that
 * auth. So we build a duck-typed adapter on top of `window.io` and pass it
 * to `JsonConfig` as `socket`.
 *
 * If the global script is missing (the user opened the iframe before the
 * script finished loading, or the host admin version is incompatible), we
 * expose a "no-op" adapter that lets the form still render in read-only
 * mode. That matches the spec scenario "Socket script fails to load".
 */

interface RawAdminSocket {
    on(event: string, cb: (...args: unknown[]) => void): void;
    off(event: string, cb: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
}

interface GlobalWithIo {
    io?: { connect: (url: string, options?: Record<string, unknown>) => RawAdminSocket };
}

const SOCKET_SCRIPT_URL = "/adapter/iobroker/admin/lib/js/socket.io.js";

/**
 * Inject the host admin's Socket.IO client as a classic <script> tag
 * before the React app boots. Returns a promise that resolves once the
 * global `window.io` is available, or rejects if the script fails to
 * load within the timeout. The caller decides whether to render
 * read-only or block on the script.
 *
 * Why a classic script (not ESM): the file is a non-module bundle that
 * assigns `globalThis.io = { connect: ... }`. Vite's HTML transformer
 * refuses to bundle <script src> tags without type="module", and adding
 * type="module" would break the file's UMD-style global assignment.
 */
export function loadHostSocketScript(timeoutMs = 5_000): Promise<void> {
    return new Promise((resolve, reject) => {
        if (typeof (globalThis as GlobalWithIo).io !== "undefined") {
            resolve();
            return;
        }
        const tag = document.createElement("script");
        tag.src = SOCKET_SCRIPT_URL;
        tag.async = false;
        const timer = globalThis.setTimeout(
            () => reject(new Error("socket.io.js load timeout")),
            timeoutMs,
        );
        tag.onload = () => {
            globalThis.clearTimeout(timer);
            resolve();
        };
        tag.onerror = () => {
            globalThis.clearTimeout(timer);
            reject(new Error("socket.io.js failed to load"));
        };
        document.head.appendChild(tag);
    });
}

/**
 * The minimal set of methods `JsonConfig` actually calls on its `socket`
 * prop. We duck-type this; the upstream type is `AdminConnection`, but
 * the methods below are the only ones the form needs to render, save,
 * and poll live data.
 */
export interface AdapterSocket {
    readonly isLive: boolean;
    getStates(pattern: string | string[]): Promise<Record<string, { val: unknown; ts?: number; lc?: number; ack?: boolean } | null | undefined>>;
    getState(id: string): Promise<{ val: unknown; ts?: number; lc?: number; ack?: boolean } | null>;
    getObject(id: string): Promise<Record<string, unknown> | null>;
    setObject(id: string, obj: Record<string, unknown>): Promise<void>;
    setState(id: string, val: unknown): Promise<void>;
    sendTo<T = unknown>(instance: string, command: string, payload?: unknown): Promise<T>;
    subscribeState(id: string, cb: (id: string, state: { val: unknown; lc?: number }) => void): () => void;
    /** Get the persisted native config object for system.adapter.<name>.<instance>. */
    getAdapterConfig(adapterName: string, instance: number): Promise<Record<string, unknown>>;
}

const noopSocket: AdapterSocket = {
    isLive: false,
    async getStates() {
        return {};
    },
    async getState() {
        return null;
    },
    async getObject() {
        return null;
    },
    async setObject() {
        throw new Error("socket.io.js not loaded; cannot save");
    },
    async setState() {
        throw new Error("socket.io.js not loaded; cannot setState");
    },
    async sendTo() {
        throw new Error("socket.io.js not loaded; cannot sendTo");
    },
    subscribeState() {
        return () => {};
    },
    async getAdapterConfig() {
        return {};
    },
};

/**
 * Wrap a `RawAdminSocket` (the result of `window.io.connect(...)`) in the
 * `AdapterSocket` interface that `JsonConfig` needs. Promisifies the
 * callback-based protocol that ioBroker's bare socket.io.js exposes.
 */
function buildAdapter(raw: RawAdminSocket): AdapterSocket {
    function call<T>(event: string, ...args: unknown[]): Promise<T> {
        return new Promise((resolve) => {
            // ioBroker socket.io convention: callback is the LAST argument
            // of the emit call. We append it and forward the rest.
            raw.emit(event, ...args, (response: T) => resolve(response));
        });
    }

    return {
        isLive: true,
        getStates(pattern) {
            return call("getStates", pattern);
        },
        getState(id) {
            return call("getState", id);
        },
        getObject(id) {
            return call("getObject", id);
        },
        async setObject(id, obj) {
            const err = await call<string | null>("setObject", id, obj);
            if (err) throw new Error(String(err));
        },
        async setState(id, val) {
            const err = await call<string | null>("setState", id, val);
            if (err) throw new Error(String(err));
        },
        sendTo<T = unknown>(instance: string, command: string, payload?: unknown) {
            return call<T>("sendTo", instance, command, payload);
        },
        subscribeState(id, cb) {
            const handler = (sid: string, state: { val: unknown }) => {
                if (sid === id) cb(sid, state);
            };
            // First do a one-shot get to seed the UI; then subscribe for live updates.
            raw.emit("getState", id, (state: { val: unknown } | null) => {
                if (state) cb(id, state);
            });
            raw.emit("subscribe", id);
            raw.on("stateChange", handler);
            return () => {
                raw.off("stateChange", handler);
            };
        },
        async getAdapterConfig(adapterName, instance) {
            const obj = await this.getObject(`system.adapter.${adapterName}.${instance}`);
            if (!obj) return {};
            return (obj as { native?: Record<string, unknown> }).native || {};
        },
    };
}

export function createAdapterSocket(adapterName: string, instance: number): AdapterSocket {
    const g = globalThis as unknown as GlobalWithIo;
    if (typeof g.io === "undefined" || typeof g.io.connect !== "function") {
        // Spec: "Socket script fails to load" — render read-only.
        // eslint-disable-next-line no-console
        console.warn("[iobroker-fmd] window.io is not available; running in read-only mode");
        return noopSocket;
    }

    try {
        const raw = g.io.connect(globalThis.location.href, {
            name: `${adapterName}.${instance}`,
            // Token would be the ioBroker admin auth token; in nested-iframe
            // auth is handled by the host admin's session, so we leave it
            // undefined and let the script's own auth flow run.
        });
        return buildAdapter(raw);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[iobroker-fmd] failed to construct adapter socket:", err);
        return noopSocket;
    }
}
