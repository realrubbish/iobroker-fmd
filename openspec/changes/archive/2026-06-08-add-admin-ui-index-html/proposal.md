# Proposal: Add Admin-UI index.html

## Why

ioBroker.admin 7.7.22 (the new React SPA) always renders the wrench pop-up for an instance as an iframe pointing at `index.html` (or `index_m.html` for materialize). Today, `iobroker-fmd` ships no `index.html`, so clicking the wrench logs `GET /adapter/iobroker-fmd/index.html?... 404` and the config screen fails to load. The current `adminUI.config = "json"` flag does **not** skip the iframe; it only affects the data source for the Instances list and the sidebar adapter tab. The `admin/settings.json` that already lives in `admin/` is reachable at `http://localhost:8081/adapter/iobroker-fmd/admin/settings.json` but is never consulted by the wrench pop-up. We must ship a real `index.html` that renders the config form inside that iframe. The full investigation is in `docs/admin-ui-investigation-2026-06-08.md`.

## What Changes

- Add a built `admin/index.html` (and `admin/index_m.html` for materialize users) that boots the ioBroker.admin React runtime, loads `@iobroker/json-config`, and renders the form defined by the adapter's `io-package.json` schema.
- Introduce `admin/jsonConfig.json5` as the canonical form definition. `admin/settings.json` is kept on disk for backwards compatibility with anything that still pings it, but `index.html` renders the form from `jsonConfig.json5`.
- Add `ringDeviceId` and `buttonStateId` to the `io-package.json` native schema so the hardware-button trigger path in `src/main.ts` (lines 13–14, 286–287) is actually configurable from the UI. These two fields are read in code today but missing from the schema, which means the button trigger silently no-ops for users who have not hand-edited JSON.
- The form keeps the existing three logical sections (Connection, Connection Status, Devices) but renders them as separate panels / cards inside a single `JsonConfig` form (no tab bar). The Status and Devices panels are read-only and bind to runtime data (`info.connection`, `info.lastError`, `0_userdata.0.FindMyDevice.*`).
- Add a build step (`npm run build:admin`) that produces the static `admin/index.html` and `admin/index_m.html` artefacts from a small React + Vite source tree under `src-admin/`.
- Update `CLAUDE.md`'s deployment workflow to include the admin build step and the `iobroker-data/files/<adapter>/io-package.json` refresh that is needed for `adminUI` flag changes to take effect.
- Update `README.md` to document the new build step and the schema fields.

## Capabilities

### New Capabilities

- `admin-ui`: How the ioBroker Admin-UI config form for `iobroker-fmd` is built, rendered, and kept in sync with runtime state. Covers the data model (`jsonConfig.json5` vs `settings.json`), the visible panels, the live data bindings, and the `Test Connection` button.
- `admin-ui-delivery`: Which files must exist in `admin/` (`index.html`, `index_m.html`, `jsonConfig.json5`, asset manifest, favicon) and which `io-package.json` `adminUI` flags must be set (`config`, `tab`) for the wrench pop-up and the sidebar adapter tab to load the form correctly.

### Modified Capabilities

_None._ This change introduces new capabilities and does not modify the requirements of any existing capability. (The adapter has no spec coverage yet under `openspec/specs/`.)

## Impact

- **New build step:** `npm run build:admin` (Vite) produces `admin/index.html`, `admin/index_m.html`, and an `assets/` folder. The output is committed to the repo so the deployment workflow does not need a Node toolchain inside the Docker container.
- **`io-package.json` schema:** adds `ringDeviceId` (text, default empty) and `buttonStateId` (text, default empty). Existing config blocks written without these keys continue to work; the adapter reads them with `?` (optional).
- **`io-package.json` `adminUI` block:** sets `adminUI.config = "json"` and does **not** set `adminUI.tab`. The missing `tab` is what makes the admin loader take the direct-to-`index.html` branch (any `tab` value would force a `tab.html`/`tab_m.html` lookup that 404s and breaks the pop-up). `adminUI.config` is left at `"json"` (not `"materialize"`) so the Instances list still renders the native jsonConfig form without an iframe.
- **Adapter code:** no runtime changes in `src/main.ts`. The two new schema fields are picked up via the existing `this.config` access path.
- **Deployment:** the workflow in `CLAUDE.md` gets one extra pre-step (build the admin assets) and one extra post-step (touch `iobroker-data/files/iobroker-fmd/io-package.json` after `iobroker upload` so the controller picks up the `adminUI` flag changes).
- **Out of scope (separate changes):** `singleInstance: true` enforcement; the `package.json` `name` field (`iobroker.fmd` vs `iobroker-fmd` workaround drift); the `iobroker upload` not refreshing `iobroker-data/files/<adapter>/io-package.json` on its own.
