# Admin UI

This document explains how the ioBroker-fmd admin UI is built, served, and
extended. For the diagnostic that motivated this work, see
[`admin-ui-investigation-2026-06-08.md`](admin-ui-investigation-2026-06-08.md).

## Why the UI exists

> **Status (2026-06-11):** the assumption below — that ioBroker.admin
> 7.7.22 always loads the adapter's `admin/index.html` in an iframe for
> the wrench pop-up — holds **only when** the admin SPA decides to take
> the iframe branch. In the user's current dev container (js-controller
> 7.1.2, ioBroker.admin 7.7.22) the SPA still renders the **native**
> `jsonConfig.json5` form for this adapter, so the custom
> `Test Connection` button, the `0_userdata.0.FindMyDevice` live panel,
> and the `App.tsx`-managed layout never appear. The page that the
> browser loads in the pop-up is the built-in ioBroker form, not our
> Vite SPA. See the [Known limitation](#known-limitation-admin-722-spa-renders-native-form) section
> below for what was verified, what is not yet known, and how to
> test-drive the missing UI manually.

ioBroker.admin 7.7.22 (the React SPA) is *expected* to render the wrench
pop-up for an adapter instance as an iframe pointing at `admin/index.html`
(or `admin/index_m.html` for materialize users). Without an `index.html`,
the browser logs `GET /adapter/iobroker-fmd/index.html?... 404` and the
pop-up fails to load. The `adminUI.config = "json"` flag does **not**
skip the iframe; it only governs the data source for the Instances list
and the sidebar adapter tab. The wrench pop-up asks for `index.html`.

The UI we ship uses the same `JsonConfig` form component that the Instances
list uses, so the form definition is the same shape across both surfaces.

## Known limitation: admin 7.22 SPA renders native form

Discovered 2026-06-11 during an E2E test session. The wrench pop-up for
`iobroker-fmd.0` shows ioBroker's built-in jsonConfig form (the same
form the Instances list uses), **not** the Vite SPA we ship at
`admin/index.html`. The visible symptoms:

- The form header reads `v0.0.1` (from `io-package.json`), not the
  custom header `App.tsx` renders
- There is no `Test Connection` button (it lives in `App.tsx`)
- There is no live `0_userdata.0.FindMyDevice` device panel
- The footer has the standard ioBroker `Save` / `Save and Close` /
  `Close` buttons, not the custom footer `App.tsx` renders

What was verified during the diagnostic:

| Check | Result |
| --- | --- |
| `GET /adapter/iobroker-fmd/index.html` | HTTP 200, returns the Vite shell with `<div id="root" class="fmd-admin-root">` and the `assets/index-DC87ih8b.js` entry |
| `App-J72l3Pde.js` contains the `Test Connection` string | Yes, 2 occurrences — the React code is in the bundle |
| `GET /lib/js/socket.io.js` | HTTP 200 — the host admin's Socket.IO client is reachable |
| `GET /validate_config/iobroker-fmd` | returns the literal string `"validated"` (hardcoded in `iobroker.admin/build/lib/web.js`) |
| Upgrade js-controller 7.0.7 → 7.1.2 | no change to the `validate_config` response — `"validated"` in both versions |

What is **not** yet known:

- The decision happens client-side in
  `iobroker.admin/admin/custom/assets/index-*.js` (a minified React
  bundle). Which specific branch skips the iframe for this adapter is
  not readable without a serious minified-JS dive.
- It is unclear whether the React `JsonConfig` import is failing on
  this admin version, whether `adminUI.config = "json"` is being read
  as a "render the schema locally" hint, or whether some other
  condition (browser cache, controller compat flag) controls it.

Workarounds for testing the SPA features manually while the iframe path
is broken:

- **Ring trigger**: the adapter still subscribes to
  `0_userdata.0.FindMyDevice.ring.*` and to the configured button
  state. Set the ring state to `true` (or write `triple_push` to the
  Shelly state) from outside the admin UI; the adapter fires the ring.
  On the user's single-device FMD account the deviceId is the username;
  see [`fmd-server-single-device-design.md`](fmd-server-single-device-design.md).
  See [Common adapter tests](docker-development.md) for the exact
  commands.
- **Test Connection** is now reachable in the native form via the
  `type: "sendTo"` schema item in `src-admin/schema.json5` (Status
  panel). The reply is shown via `window.alert` (the ioBroker admin
  default for the built-in `ConfigSendTo` widget). The 12s
  `Promise.race` timeout and the inline `Last Test Result: <msg> at
  HH:MM:SS` formatting remain gated behind the iframe path — they
  run in `App.tsx`'s fallback `<button>`, which is rendered only when
  the surrounding surface is the Vite SPA (i.e. a future admin
  version that takes the iframe branch). The change is the
  `add-or-fix-test-button-in-admin-pop-up` OpenSpec change.

Until a follow-up investigation identifies the admin-SPA branch that
gates the iframe, treat any "the live device panel is missing" or
"`App.tsx`-managed layout is missing" reports as
expected-on-7.7.22 / js-controller-7.1.2. The Test Connection button
is no longer in that list — it is reachable in the deployed native
form. The adapter code itself is correct; the gap is purely a
delivery surface.

## Build pipeline

```
src-admin/                        source (TypeScript, JSON5, HTML)
├── index.html                    entry — non-materialize
├── index_m.html                  entry — materialize
├── main.tsx                      React 18 + Vite ESM entry
├── main_m.tsx                    React 18 + Vite ESM entry (materialize)
├── App.tsx                       mounts <JsonConfig> with schema + socket
├── socket.ts                     adapter-socket wrapper around window.io
├── schema.json5                  source-of-truth for the form definition
├── vite.config.ts                Vite + JSON5 plugin
└── tsconfig.json                 strict TS, React 18 JSX

admin/                            build output (committed)
├── index.html                    non-materialize
├── index_m.html                  materialize
├── assets/                       Vite-built JS bundles (1.7 MB gzipped)
├── jsonConfig.json5              copy of src-admin/schema.json5
├── settings.json                 hand-managed, kept for back-compat
└── favicon.ico                   hand-managed (from iobroker.admin)
```

`npm run build:admin` runs `scripts/build-admin.mjs`, which:

1. Removes only the build outputs in `admin/` (`index.html`, `index_m.html`,
   `assets/`).
2. Invokes Vite to regenerate them from `src-admin/`.
3. Copies `src-admin/schema.json5` to `admin/jsonConfig.json5` so the
   controller can serve it.

`admin/settings.json` and `admin/favicon.ico` are hand-managed and never
touched by the build. Vite's own `emptyOutDir` is disabled to keep them
intact.

## Why a Vite SPA inside an iframe

The host ioBroker.admin bundle (`node_modules/iobroker.admin/adminWww/`)
ships its own Socket.IO client as a classic `<script>` at
`/adapter/iobroker/admin/lib/js/socket.io.js`. That script attaches
`window.io = { connect: ... }` for nested iframes to consume. We:

1. **Bundle `@iobroker/json-config` and React via Vite** (npm dependency,
   tree-shaken, served from `admin/assets/`). jsonConfig is the same
   component the Instances list uses, so the form definition is one schema
   for both surfaces.
2. **Load the host's `socket.io.js` at runtime** via a `<script>` tag
   injected from `main.tsx`/`main_m.tsx` at boot. This reuses the host
   admin's authenticated session — the iframe has no separate credentials.
3. **Wrap the raw `window.io` in a duck-typed adapter socket** in
   `src-admin/socket.ts`. JsonConfig calls `socket.getStates`, `getState`,
   `setObject`, `sendTo`, `subscribeState` on its `socket` prop; we provide
   exactly those. The wrapper is ~80 lines, no further state.

If the global `window.io` is missing (the script failed to load), the
wrapper degrades to a no-op that renders the form read-only and shows a
"Live data unavailable" banner. That matches the OpenSpec scenario "Socket
script fails to load".

## File responsibilities

| File | Owns |
|---|---|
| `src-admin/index.html`, `index_m.html` | HTML shell, root container, runtime socket-script injection happens from `main.tsx` |
| `src-admin/main.tsx`, `main_m.tsx` | Parse `?<instance>&newReact=true&<instance>&react=<theme>` from the URL, load `socket.io.js`, mount `App` |
| `src-admin/App.tsx` | Construct the adapter socket, seed initial native config, run the 5 s polling loop, mount `<JsonConfig>` |
| `src-admin/socket.ts` | Inject `<script src="/adapter/iobroker/admin/lib/js/socket.io.js">`, wrap `window.io.connect(...)` in the methods JsonConfig needs |
| `src-admin/schema.json5` | The form definition (panels, fields, sendTo buttons, static text) |
| `src-admin/vite.config.ts` | Two rollup inputs, JSON5 plugin (no `resolveId`/`load` needed since `schema.json5` lives inside `root`), `emptyOutDir: false` |
| `scripts/build-admin.mjs` | Reconcile `admin/` before/after the Vite run |
| `io-package.json` | Schema fields (serverUrl, username, password, ringDeviceId, buttonStateId), `adminUI.config = "json"`, **no** `adminUI.tab` (setting `tab` to anything makes the admin loader probe for `tab.html`/`tab_m.html` and break the pop-up) |

## Module-federation contract

We do **not** consume `iobroker.admin`'s Module-Federation `remoteEntry.js`.
Spike against `iobroker.admin@7.7.22` showed the admin is itself a MF
**Remote** (`globalName: iobroker_admin`, `exposes: []`, `remotes: []`) —
a standalone SPA that shares React/MUI/JsonConfig with potential
consumers, but does not *expose* anything for consumers to import.

The runtime contract is therefore narrower:

- **`window.io` global** with the `connect(url, { name, token? })` method,
  sourced from `/adapter/iobroker/admin/lib/js/socket.io.js`. The contract
  surface is the `ioBroker` socket protocol (`getStates`, `getState`,
  `setObject`, `sendTo`, `subscribe`, `stateChange` events).
- **`/adapter/iobroker/admin/lib/js/socket.io.js`** URL. If the host admin
  ever renames or relocates the file, the only fix is to update the
  `SOCKET_SCRIPT_URL` constant in `src-admin/socket.ts`.

## Upgrading the host admin version

When a new `iobroker.admin` ships:

1. `npm install -D iobroker.admin@<new>` (in `/tmp`, for reference only).
2. Diff `node_modules/iobroker.admin/adminWww/lib/js/socket.io.js` for
   breaking changes. The current API is `io.connect(url, { name, token? })`
   and emits `MESSAGE`/`PING`/`PONG`/`CALLBACK` opcodes; a future major
   version could change either.
3. Diff `node_modules/@iobroker/json-config` for `JsonConfig` prop changes.
   `App.tsx` passes a minimal `IobTheme`; if a new theme prop becomes
   required, add it there.
4. Re-run the spike, then the Docker test in `CLAUDE.md`.

## Manual Docker test

After every change to `src-admin/`, `admin/index*.html`, or
`io-package.json`, follow the **Deployment & Testing Workflow** in
`../CLAUDE.md`. The two steps that are easy to forget:

- `npm run build:admin` after `git push` (the Docker container does not run
  the build).
- `touch /opt/iobroker/iobroker-data/files/iobroker-fmd/io-package.json`
  after `iobroker upload` when `io-package.json` changed (controller
  caching).

## Form definition (`schema.json5`)

`schema.json5` is JSON5, not JSON. The Top-Level must be a `panel` or
`tabs` (we use `panel`). `items` is a map of `key → ConfigItem`. The
relevant item types for this adapter:

- `text` — single-line text field
- `password` — same as text but masked in the UI
- `staticText` — read-only label
- `sendTo` — button that calls `socket.sendTo(instance, command, data)`
  and renders a result widget inline

Field names (`serverUrl`, `username`, `password`, `ringDeviceId`,
`buttonStateId`) **must** match the `io-package.json` native keys. The
JsonConfig form save path uses those exact names when calling
`setObject('system.adapter.iobroker-fmd.0', { native: ... })`.

Adding a new field is a two-file change: add the property to
`io-package.json`'s `schema.properties` AND to `src-admin/schema.json5`.

## Connection Status panel

The Status panel shows three live values, all driven by the 5-second
polling loop in `App.tsx`:

- **Status** — derived from `info.connection` (`connected` / `disconnected`
  / `unknown`).
- **Last Error** — `info.lastError`, refreshed every 5 s.
- **Last Test Result** — the formatted reply of the most recent
  `Test Connection` click. Defaults to `(click Test Connection to run)`
  and persists across polling cycles until a fresh `info.lastError` is
  observed (so a stale "OK" line is cleared the moment the live state
  diverges from it).

### Test Connection button

`App.tsx` renders a real `<button>` below the form (not a
`type: "sendTo"` schema item). The reason is that `JsonConfig`'s built-in
`ConfigSendTo` widget surfaces the reply via `window.alert` and exposes
no callback to push the result into a `staticText` line with our own
timestamp format. A custom button + a direct `socket.sendTo` call gives
us full control over placement, copy, and formatting.

The click calls `socket.sendTo('<adapterName>.<instance>', 'testConnection', {})`
and the adapter's `onMessage.testConnection` handler (in `src/main.ts`)
replies with one of:

- `{ success: true, message: "Connected successfully" }` — rendered as
  `OK – connected at HH:MM:SS`.
- `{ error: "<reason>" }` — rendered as `Failed – <reason> at HH:MM:SS`.
  The same string is also pushed into `info.lastError` by the handler
  on its way out, so the live `Last Error` field reflects the same
  failure within one polling cycle.

The reply contract is owned by the adapter and documented in the
`admin-ui` capability (see `openspec/specs/admin-ui/spec.md`,
Requirement "Test Connection button is present"). The
`add-test-connection-button` change (`openspec/changes/archive/`)
introduced the button and the `Last Test Result` line.

The button is disabled while a test is in flight and when the host
admin's `socket.io.js` failed to load (so a click cannot produce a
silent no-op).
