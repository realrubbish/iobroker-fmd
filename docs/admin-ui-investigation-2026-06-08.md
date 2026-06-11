# Admin-UI Investigation (2026-06-08)

Status: planning input for the upcoming OpenSpec change that adds `index.html` to the iobroker-fmd admin folder.

## Symptom (in the user's words)

Click on the `iobroker-fmd.0` instance row, click the wrench icon, browser console shows:

```
GET http://localhost:8081/adapter/iobroker-fmd/index.html?0&newReact=true&0&react=light 404 (Not Found)
```

The Config screen in the new ioBroker.admin SPA fails to load.

## Environment

- ioBroker.admin 7.7.22 (the new React SPA, asset bundle in `node_modules/iobroker.admin/adminWww/`)
- js-controller 7.0.7
- Node v22.22.2
- Adapter: `iobroker-fmd` 0.0.1, single instance on `.0`

## What we already verified (does not work as-is)

| Approach | Result |
|---|---|
| `adminUI.config = "json"` (original setting) | iFrame loaded `index.html` → 404 |
| `adminUI.config = "admin/settings.json"` (my first fix attempt) | jsonConfig react component skipped, but iFrame still loaded `index.html` → 404 |
| `adminUI.config = "json"` + restored io-package.json | Same 404 |
| Direct URL `http://localhost:8081/adapter/iobroker-fmd/admin/settings.json` | 200, the asset is reachable |
| React admin `jsonConfig` component path | Loaded into the Instances list / adapter tab, NOT the wrench pop-up |

## Findings from reading the admin bundle (definitive)

In `node_modules/iobroker.admin/adminWww/assets/Config-Cz5Tb3cJ.js` the relevant logic is:

```js
componentDidMount() {
  if (this.props.tab) {
    this.props.socket.fileExists(`${this.props.adapter}.admin`, "tab.html").then(t => {
      if (t) this.setState({ checkedExist: "tab.html" });
      else return this.props.socket.fileExists(`${this.props.adapter}.admin`, "tab_m.html")
        .then(o => o ? this.setState({ checkedExist: "tab_m.html" })
                     : window.alert("Cannot find tab(_m).html"));
    });
  } else {
    this.setState({ checkedExist: this.props.materialize ? "index_m.html" : "index.html" });
  }
}

// later, in render:
const e = `${this.props.tab ? this.state.checkedExist
                             : this.props.materialize ? "index_m.html" : "index.html"}?${this.props.instance||0}&newReact=true&${this.props.instance||0}&react=${this.props.themeName}`;
return this.state.checkedExist ? s.jsx("iframe", { ..., src: e }) : null;
```

Where `props.materialize` and `props.tab` come from the host:

```js
materialize: w.adminUI.config === "materialize"
// and (from bootstrap):
adminUI.tab = "html"            // → props.tab = true, loads tab.html
adminUI.tab = "materialize"     // → props.tab = true, props.materialize = true, loads tab_m.html
adminUI.tab unset / something else // → props.tab = false, loads index.html (or index_m.html)
```

There is **no branch that skips the iframe when `adminUI.config === "json"`**. The wrench pop-up always renders an iframe pointing at `index.html` (or `index_m.html` when `materialize`). It does not consult `adminUI.config === "json"` for the iframe — that flag only governs which data the Instances list passes to a different component (the one rendered in the adapter sidebar tab, not the wrench pop-up).

The 404 is therefore the **expected** behaviour for an adapter that ships no `index.html` and uses `adminUI.config = "json"`.

## Reference: backitup (the established workaround)

`iobroker.backitup` ships with `adminUI.config = "json"` AND `adminUI.tab = "materialize"` AND a `tab_m.html` (a full React build) in its `admin/` folder. It also sets `adminTab` in `common` to give the adapter a left-sidebar tab. With that combination:

- The Instances list shows the jsonConfig form (no iframe)
- The left sidebar shows `tab_m.html` for adapter-level pages (also an iframe, but at a different URL)
- The wrench pop-up does NOT 404 in practice because backitup's `tab_m.html` exists and is loaded instead of `index.html` when `adminUI.tab === "materialize"` — wait, this is wrong; backitup's wrench pop-up would also try `index_m.html` when `props.materialize` is true. We did not verify whether backitup actually has `index_m.html`. **TODO: re-check this in the change.**

Actually re-reading: when `props.tab` is true (i.e. we are in the sidebar tab, NOT the wrench pop-up), the code does the `fileExists` dance. When `props.tab` is false (wrench pop-up on a single instance), it directly uses `index_m.html`. So the wrench pop-up on a `materialize` adapter STILL tries `index_m.html`. We need to verify whether backitup ships `index_m.html` or whether it somehow escapes the iframe.

The most reliable conclusion from the static analysis: the wrench pop-up on any adapter that uses `adminUI.config = "json"` will load `index.html` (or `index_m.html` if `materialize`) into an iframe. We must ship one of those files. A minimal `index.html` is the lowest-cost fix.

## Recommended approach for the OpenSpec change

The change is **"ship a working Admin-UI config form"** — i.e. add a new file `admin/index.html` (and optionally `admin/index_m.html`) that:

1. Boots the React + module-federation runtime that ioBroker.admin ships in `adminWww/`.
2. Loads the `JsonConfig` component from `@iobroker/json-config` (the same component the Instances list uses).
3. Renders the existing `io-package.json` `schema.properties` (and any future `jsonConfig.json5` if we add one) directly.

This is the same path backitup uses, but we would implement it from scratch because backitup's `tab_m.html` is a CRA build (create-react-app, deprecated) and not reusable.

Alternative low-effort path (acceptable for v0.x, must be replaced before 1.0): ship a static `index.html` that just renders a `<form>` with the three fields from `io-package.json` and posts via the `system.adapter.iobroker-fmd.0` object update endpoint. This is much less code but loses the test-button and the device panel from `settings.json`.

## Pre-existing issues that this change should also fix

While investigating, we found these. They are not blockers for the Admin-UI work but should be addressed in the same change for hygiene:

- **Doppelte Instanzen:** `iobroker add iobroker-fmd` does not refuse to create a second instance even though `singleInstance: true` is set in `io-package.json`. Decide whether `iobroker add` should error out, or whether `singleInstance` is just documentation.
- **Fehlende Config-Felder:** `main.ts` reads `config.ringDeviceId` and `config.buttonStateId`, but neither is in the `io-package.json` schema or in `admin/settings.json`. The hardware button trigger silently does nothing for users who do not edit JSON.
- **Workaround-Pfade:** `node_modules/iobroker.fmd/` (legacy name) and `node_modules/iobroker.iobroker-fmd/` (workaround name) both need to be kept in sync after every build. The repo's `CLAUDE.md` documents this but it remains a footgun. The `package.json` field `name` is still `iobroker.fmd` (should be `iobroker-fmd` for the workaround to actually work as a symlink or for npm to install under the right name).
- **Container-Drift:** `iobroker upload iobroker-fmd` does **not** refresh `iobroker-data/files/<adapter>/io-package.json` — only the admin assets. The diagnosis earlier (wrong `adminUI.config` value) was caused by this silent staleness. The OpenSpec change should call out: rebuild → `docker cp` → `iobroker upload` are not enough, the `io-package.json` in `iobroker-data/files/` must also be touched.

## Open questions for the propose phase

1. Do we want tabs (Connection / Status / Devices) in the Admin-UI, or is a single flat form acceptable? The current `admin/settings.json` has tabs. A flat jsonConfig form would drop the Status panel (which reads `info.connection` and `info.lastError`) and the Devices panel (which lists ring states).
2. Do we want to keep `admin/settings.json` as the source of truth and just bootstrap it from `index.html`, or do we migrate fully to `jsonConfig.json5`?
3. Should the `io-package.json` schema include `ringDeviceId` and `buttonStateId` so the hardware button trigger is usable from the UI?

These are decisions for the `proposal.md` step of the change.

## Status: resolved

This investigation became the OpenSpec change
`add-admin-ui-index-html` (see `openspec/changes/add-admin-ui-index-html/`
and the implementation in `src-admin/`, `admin/`, and `docs/admin-ui.md`).
The decisions made:

1. **Flat form, not tabs.** A `jsonConfig` panel-based layout (Connection,
   Hardware Button Trigger, Connection Status, Devices) instead of a
   `settings.json`-style tab bar. We keep `admin/settings.json` on disk
   for back-compat, but the rendered form reads from `jsonConfig.json5`.
2. **Single source of truth = `jsonConfig.json5`.** `App.tsx` imports
   `src-admin/schema.json5`, the build copies it to
   `admin/jsonConfig.json5`. `settings.json` is not consulted.
3. **`ringDeviceId` and `buttonStateId` are in the schema.** Both are
   optional, both default to `""`, both are exposed in the UI's
   "Hardware Button Trigger" panel.

The wrench pop-up now serves `admin/index.html` (or `admin/index_m.html`),
which mounts the `JsonConfig` component with the schema and a live
adapter socket that reuses the host admin's `socket.io.js` global. See
[`admin-ui.md`](admin-ui.md) for the build pipeline, the
module-federation contract, and the upgrade procedure.

## Status update (2026-06-11)

The implementation from this investigation was merged (the
`add-admin-ui-index-html` change and its follow-ups) and the
container-side artifacts (`admin/index.html`, `admin/index_m.html`,
`admin/assets/`, `admin/jsonConfig.json5`) are present in the
container after `iobroker url https://github.com/realrubbish/iobroker-fmd`.

**However**, in a fresh E2E test on 2026-06-11 (js-controller 7.1.2,
ioBroker.admin 7.7.22), the wrench pop-up does **not** load the Vite
SPA. It renders the native ioBroker jsonConfig form. The Test
Connection button was the wrong action for a wrench pop-up that
already exposes the adapter's auth state and the `npm run auth:smoke`
script for credential verification. The follow-up change
`add-ring-button-in-admin-pop-up` re-purposes the Status-panel
button slot to a `Ring Device` sendTo item (command: `ring`, payload:
`{ deviceId: config.ringDeviceId }`). The live
`0_userdata.0.FindMyDevice` device panel and the `App.tsx`-managed
layout remain gated behind the iframe path and are tracked as a
separate follow-up. The `v0.0.1` header in the form, the standard
`Save` / `Save and Close` / `Close` buttons, and the
`FMD Server URL` / `Username` / `Password` field order all come from
`admin/jsonConfig.json5` consumed by the admin SPA directly — not
from our `App.tsx`.

The Vite SPA path is still reachable as a standalone URL
(`http://localhost:8081/adapter/iobroker-fmd/`), the bundle is
correct, and `socket.io.js` loads. The bug is a client-side
decision in the minified `iobroker.admin` bundle that skips the
iframe for this adapter; the controller and admin versions installed
in the test container are at the levels this investigation assumed
would always take the iframe path.

The full diagnosis and the workarounds (manual ring trigger via
`iobroker state set`, manual ring via the standalone SPA URL) are
recorded in
[`admin-ui.md` § Known limitation](admin-ui.md#known-limitation-admin-722-spa-renders-native-form).
A follow-up investigation is needed to identify the exact branch
in the admin SPA that gates the iframe; the current `getDevices`
finding (returns `[]` for the user's single-device account, so the
deviceId has to be known a priori) is tracked separately in
[`fmd-server-single-device-design.md`](fmd-server-single-device-design.md).
