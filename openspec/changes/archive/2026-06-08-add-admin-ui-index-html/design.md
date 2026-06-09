# Design: Add Admin-UI index.html

## Context

ioBroker.admin 7.7.22 (the new React SPA) always renders the wrench pop-up for an adapter instance as an iframe. The relevant logic lives in `node_modules/iobroker.admin/adminWww/assets/Config-Cz5Tb3cJ.js`:

```js
const e = `${this.props.tab ? this.state.checkedExist
                             : this.props.materialize ? "index_m.html" : "index.html"}?${this.props.instance||0}&newReact=true&${this.props.instance||0}&react=${this.props.themeName}`;
return this.state.checkedExist ? s.jsx("iframe", { ..., src: e }) : null;
```

The `adminUI.config = "json"` flag does NOT skip the iframe; it only governs which component the Instances list and the sidebar adapter tab render. The wrench pop-up always asks for `index.html` (or `index_m.html` for materialize users). Shipping no `index.html` produces the observed 404.

`iobroker-fmd` is a TypeScript ioBroker adapter (`create-adapter` template) that uses `encryptedNative` for credentials. The repo currently ships `admin/settings.json` with three tabs (Connection, Connection Status, Devices) and a Test Connection button. The schema in `io-package.json` is missing `ringDeviceId` and `buttonStateId`, which `src/main.ts` reads at lines 13–14 and 286–287.

Reference implementation: `iobroker.backitup` ships a CRA-built `tab_m.html` and a `jsonConfig.json5` with `adminUI.tab = "materialize"`. We borrow the **pattern** (React bundle in `admin/`, jsonConfig as the form definition) but not the build tooling (CRA is deprecated; Vite is the modern equivalent).

## Goals / Non-Goals

**Goals**

- A working wrench pop-up that renders the config form, persists changes, and shows live status / device list.
- A build pipeline that produces the admin assets deterministically and is committed to the repo.
- A single source of truth for the form definition (`jsonConfig.json5`).
- The two missing schema fields (`ringDeviceId`, `buttonStateId`) become first-class config options.
- Documented deployment workflow that survives the silent staleness of `iobroker-data/files/<adapter>/io-package.json`.

**Non-Goals**

- Migrating to a different admin framework.
- Adding new live data sources beyond `info.connection`, `info.lastError`, and `0_userdata.0.FindMyDevice.*`.
- A real React Native / mobile UI (out of scope for the admin web iframe).
- Publishing the adapter to npm (still a 1.0.0 milestone).
- Fixing `singleInstance: true` enforcement, the `package.json` name drift, or the `iobroker upload` controller bug (separate changes).

## Decisions

### D1. Form source: `jsonConfig.json5`, drop `settings.json` from the render path

- **Decision:** `index.html` renders the form from `admin/jsonConfig.json5`. `admin/settings.json` stays on disk for backward compatibility but is not loaded by `index.html`.
- **Why:** `jsonConfig` is the ioBroker-native schema consumed by the `JsonConfig` component that the admin SPA already uses for the Instances list. Reusing it removes a parallel schema to maintain.
- **Why not tabs:** The current `settings.json` uses `type: "tabs"` (the legacy socket-client settings format), not jsonConfig tabs. jsonConfig uses panels / cards. We accept the visual loss (no tab bar) in exchange for dropping a hand-rolled settings loader.
- **Why not `settings.json` as source of truth:** It is not the native schema; loading it would require a custom React component. `jsonConfig.json5` is consumed by the same component the Instances list uses.

### D2. Build tool: Vite + React + TypeScript

- **Decision:** Source tree under `src-admin/`, built with Vite to `admin/index.html`, `admin/index_m.html`, and `admin/assets/`. React 18 + TypeScript.
- **Why Vite:** Replaces CRA (deprecated since 2023, used by backitup). Vite is the default in `create-adapter` for new admin UIs as of 2025.
- **Why not Webpack / Parcel:** Vite is the path of least resistance for an SPA that consumes module-federation content from a host bundle.
- **Why commit `admin/index.html` to the repo:** the Docker dev container does not run `npm install` for the adapter's own dev dependencies, only for the adapter runtime. Building once on the dev host and shipping the artefacts keeps the deploy workflow free of Node toolchain requirements inside the container.

### D3. Runtime composition: npm-bundled `@iobroker/json-config` + global Socket.IO from the host admin bundle

- **Decision:** `index.html` does two things at startup:
  1. **Bundled by Vite** (npm dependency, imported normally): the `JsonConfig` component from `@iobroker/json-config@8.x`, plus React/ReactDOM. These are tree-shaken, minified, and served from `admin/assets/`.
  2. **Loaded as a global `<script>` tag from the host admin bundle**: `socket.io.js`, fetched at runtime from `/adapter/iobroker/admin/lib/js/socket.io.js`. The script attaches `window.io = { connect: connect }` for the bundled code to consume.
  3. **A small adapter-socket wrapper** lives in `src-admin/socket.ts` (~50 lines). It calls `window.io.connect(location.href, { name: adapterName + "." + instance })` and exposes the `getStates`, `getState`, `setObject`, `sendTo`, `subscribe` API that `JsonConfig` expects. This is the same wrapper every ioBroker-admin adapter ships; reusing the pattern is cheaper than depending on the admin's internal helper.
- **Why not module-federation:** A spike against `iobroker.admin@7.7.22`'s `adminWww/mf-manifest.json` shows that the admin adapter is itself a Module-Federation **Remote** (`globalName: iobroker_admin`, `exposes: []`, `remotes: []`) — i.e. a standalone SPA that shares React/MUI/JsonConfig with potential consumers, but does not *expose* JsonConfig as a federated module. Consuming JsonConfig via MF would require writing a custom Vite plugin around `@module-federation/runtime`, with no payoff: JsonConfig is a regular npm package and is cheaper to bundle directly.
- **Vite-quirk to remember:** MUI's `@mui/styled-engine` declares `@emotion/react` and `@emotion/cache` as peer dependencies. Vite/Rollup treats unlisted peer deps as `__vite-optional-peer-dep` and refuses to bundle them. We add both packages as **devDependencies** of the adapter, even though we never `import` them — Vite resolves the peer-dep through the dev install and the bundle compiles. Without this, the build fails with `"CacheProvider" is not exported by "__vite-optional-peer-dep:@emotion/react:@mui/styled-engine"`.
- **Why not vendor the full admin bundle:** ~5–10 MB of React/MUI/socket.io per adapter, and a constant update treadmill. The only thing we actually need from the host is the socket.io client (because the bundled version in `@iobroker/socket-client` doesn't speak the admin auth protocol the admin UI uses).
- **Why this is the same pattern backitup uses, in practice:** `iobroker.backitup`'s `tab_m.html` is a CRA build that imports `socket.io-client` and `@iobroker/json-config` as npm dependencies and uses `<script src="/adapter/iobroker/admin/lib/js/socket.io.js">` for the live socket. We replicate that pattern, just with Vite instead of CRA.
- **Risk:** The host admin may rename or relocate `lib/js/socket.io.js` in a future release. Mitigation: keep the script-tag URL as a single constant in `src-admin/`; if it moves, the fix is one URL change. We also tolerate failure: if the script fails to load, the form still renders in a "live data unavailable" state and the user can still save the form (writes go through the standard `setObject` admin socket, which is what the script provides).
- **Spike result (2026-06-08, `/tmp/fmd-admin-spike`):**
  - `iobroker.admin@7.7.22` installs cleanly; the `adminWww/` bundle ships `mf-manifest.json`, `remoteEntry.js`, and the expected `lib/js/socket.io.js`.
  - `@iobroker/json-config@8.4.7` bundles through Vite after `@emotion/react` + `@emotion/cache` are added as devDeps. Build is 7.6 MB unminified / 1.7 MB gzipped (size warning expected; `manualChunks` is a follow-up optimization, not a blocker).
  - `JsonConfig` is a **named export** (not `default`) from `@iobroker/json-config`. `import { JsonConfig } from "@iobroker/json-config"`.
  - `socket.io.js` (9 KB) exposes `globalThis.io = { connect: connect }`. The full SocketClient class is reachable from the returned instance; the adapter-socket wrapper builds the `getStates`/`getState`/`setObject`/`sendTo`/`subscribe` surface on top of that.
  - The bundled-via-Vite + global-socket.io-from-host + small-wrapper pattern is the path of least resistance and matches the existing backitup pattern.

### D4. io-package.json adminUI flags: `config = "json"`, no `tab`

- **Decision:** Set `common.adminUI.config = "json"`. Do **not** set `common.adminUI.tab`.
- **Why no `tab`:** The admin's `Config-*.js` branching is `if (this.props.tab) { fileExists("tab.html") → fileExists("tab_m.html") → alert } else { direct to index.html / index_m.html }`. If we set `adminUI.tab = "html"` (or `"materialize"`), the loader tries `tab.html` / `tab_m.html` first, finds neither, and pops `window.alert("Cannot find tab(_m).html")` — breaking the wrench pop-up entirely. The only configuration that loads `index.html` is the one where `adminUI.tab` is unset, which is what we ship.
- **Why not set `tab = "materialize"`:** that would still require shipping `tab_m.html` (a different iframe target used for the sidebar adapter tab, not the wrench pop-up) and would force a materialize build. We do not need it.
- **Why keep `config = "json"`:** the Instances list and the sidebar adapter tab use the native jsonConfig form (no iframe). Without `config = "json"`, those surfaces would also try to load an iframe, which we do not want.

### D5. Schema: add `ringDeviceId` and `buttonStateId`

- **Decision:** Add both fields to the native schema in `io-package.json` as optional text fields with sensible defaults (`""`). Expose them in `jsonConfig.json5` as part of the Connection panel.
- **Why add them:** `src/main.ts` already reads them. The current behavior is "hardcoded button trigger path silently works for the dev, silently no-ops for everyone else." Adding them to the schema turns the dev shortcut into a real feature.
- **Why not drop the code path:** the test infrastructure (`triple_push` from the Shelly button) is part of the project's vision (`docs/vision.md`).

### D6. Live data: poll every 5 seconds, no WebSocket

- **Decision:** Status and Devices panels poll the controller every 5 seconds via the existing `getStates` admin socket call. No new WebSocket subscription.
- **Why:** ioBroker.admin already exposes a polling-friendly socket. A 5-second cadence is well under the user's perception threshold for "is the status current?" and avoids a long-lived WebSocket inside an iframe that the admin SPA may discard.
- **Why not WebSocket:** WebSockets in nested iframes are subject to per-frame connection limits and to the host's lifecycle. Polling is boring and works.

### D7. License of the new `src-admin/` source: MIT

- **Decision:** New `src-admin/` source is MIT-licensed, matching the rest of the repository.
- **Why:** the repo is a public open-source adapter; mixing licenses would be a needless complication.

## Risks / Trade-offs

- **[Module-federation contract drift]** The host admin bundle (`iobroker.admin`) may change the exposed module paths in a future release, breaking our `index.html`. → **Mitigation:** pin to a known-good admin version in the test workflow (`iobroker.admin 7.7.22`); document the upgrade procedure in `CLAUDE.md` as "rebuild, test, ship."

- **[Committed build artefacts]** Shipping `admin/index.html` and `admin/assets/` in git means the repo size grows and PR diffs include generated files. → **Mitigation:** the artefacts are required for the Docker deploy to work without a Node toolchain; add a CI check that fails if the committed artefacts are stale relative to `src-admin/`.

- **[Vite build time]** Adding Vite + React + TypeScript to the dev toolchain adds `~3 s` to a cold `npm install` and `~5 s` to a clean `npm run build:admin`. → **Mitigation:** keep the `src-admin/` tree small; cache Vite's prebundle dir in CI.

- **[iobroker upload does not refresh io-package.json]** Already known. → **Mitigation:** document the `touch` step in `CLAUDE.md`'s deployment workflow.

- **[Two index.html entry points to keep in sync]** We commit to two HTML files. → **Mitigation:** both are produced from the same Vite config with two input files; the only difference is the CSS class name prefix.

## Migration Plan

1. Land the change on `main` behind the normal `git push` + `docker compose up -d` + `iobroker url` + `iobroker upload` flow documented in `CLAUDE.md`.
2. After the first deploy, hard-reload the ioBroker.admin page in the browser (Cmd/Ctrl+Shift+R) to clear the cached 404.
3. Click the wrench on `iobroker-fmd.0`. Verify the form appears, the three Connection fields are populated, the Status panel shows `info.connection` correctly, and the Devices panel lists the user's `0_userdata.0.FindMyDevice.ring.*` states.
4. Enter test credentials, save, restart the instance, send a ring command via `0_userdata.0.FindMyDevice.ring.<id> = true`, and verify in `docker exec iobroker-fmd-dev iobroker logs iobroker-fmd --files=20`.

**Rollback:** revert the commit. The previous (broken) state was a 404 in the wrench pop-up; the previous (working) state was a working native form. Reverting returns to the 404. The `iobroker-data/files/iobroker-fmd/io-package.json` `touch` step means a rollback also needs that file restored from git or a known-good build.

## Open Questions

- **Should the build emit a single `index.html` that re-themes itself for materialize, or two separate files?** The current design assumes two files because Vite's two-input setup is the simplest. Revisit if the artefact size becomes a problem.
- **Should the `Test Connection` button survive the migrate-to-`jsonConfig` move?** Yes per the spec, but the jsonConfig `button` widget's `sendTo` semantics need a one-line verification during implementation. If `sendTo` does not work in a nested iframe, we fall back to a custom widget that calls `socket.sendTo` directly.
- **Do we want a separate `tab_m.html` for the sidebar adapter tab?** The spec assumes no. If we later want a richer adapter-level page (logs, history, ring analytics), that is a follow-up change.
