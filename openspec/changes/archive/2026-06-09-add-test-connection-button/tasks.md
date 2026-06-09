## 1. Schema and React wiring

- [ ] 1.1 Read `@iobroker/json-config`'s `ConfigTextSendTo` TypeScript definition in `node_modules/@iobroker/json-config/` and record the exact required keys (`type`, `label`, `command`, optional `result` sub-schema). If the file is not present locally, install it as a devDependency first or read the published types from a documentation URL. Document the shape in a comment above the new schema item so the choice is auditable.
- [ ] 1.2 In `src-admin/schema.json5`, under the `status` panel's `items`, add a new `testConnection` field of `type: "sendTo"` with `command: "testConnection"` and a `label: "Test Connection"`. Use the exact shape confirmed in 1.1 (with the minimum required `result` sub-schema if needed). Remove the `NOTE on Test Connection button` block from the file header.
- [ ] 1.3 In `src-admin/schema.json5`, under the `status` panel's `items`, add a new `testResult` field of `type: "staticText"` with `label: "Last Test Result"` and `text: "(click Test Connection to run)"`. This is the placeholder line that will be overwritten by `App.tsx`.
- [ ] 1.4 In `src-admin/App.tsx`, replace the dead `useEffect` at lines 118-126 with logic that subscribes to the `sendTo` reply. Concretely: drop the `setTestResult("(click Test Connection to run)")` no-op, and instead either (a) pass a new prop JsonConfig exposes for `sendTo` responses, or (b) wrap the `Test Connection` field in a custom render path that calls `socket.sendTo("0", "testConnection", {})` directly. Whichever path is chosen, on success call `setTestResult(\`OK – connected at ${now()}\`)` and on error `setTestResult(\`Failed – ${err} at ${now()}\`)`.
- [ ] 1.5 In `src-admin/App.tsx`'s 5 s polling effect (lines 62-113), inside the `setData((prev) => ...)` callback, observe whether `err && err.val` is non-empty. When it transitions from empty to non-empty, also call `setTestResult("(click Test Connection to run)")` so a stale "OK" line is cleared. Update the off-screen `<div aria-live="polite">` block (lines 184-189) to render the result as a real visible `<p>` element above the `<JsonConfig>` form, or pass the latest value into `data.testResult` and let JsonConfig's `staticText` widget render it.
- [ ] 1.6 In `src-admin/App.tsx`, ensure the `data` prop passed to `<JsonConfig>` includes `testResult: { val: testResult }` so the schema's `staticText` widget renders the current value. Confirm the formatter for the timestamp uses `new Date().toLocaleTimeString()` (browser locale) so the "HH:MM:SS" claim in the spec is satisfied.

## 2. Build and commit artefacts

- [ ] 2.1 Run `npm run build:admin` and verify the regenerated `admin/index.html` / `admin/index_m.html` / `admin/assets/` contain the new form item. Open one of the assets and grep for `Test Connection` to confirm the bundle includes the new label.
- [ ] 2.2 Run `npm run build:tsc` to confirm the TypeScript changes in `App.tsx` compile cleanly. Fix any type errors that surface (likely around the `JsonConfig` prop type if a new `onCommand` callback is added).
- [ ] 2.3 Stage and commit the change as a single conventional commit: `feat(admin): add Test Connection button to Status panel` (with `src-admin/schema.json5`, `src-admin/App.tsx`, and the regenerated `admin/` artefacts in the same commit, per `CLAUDE.md` step 2).

## 3. Verify against a live FMD server

- [ ] 3.1 From the dev host (NOT the Docker container), run `npm run auth:smoke` with `FMD_SERVER_URL=https://fmd.example.com`, valid `FMD_USERNAME` and `FMD_PASSWORD`. Confirm exit 0 and the `OK access_token=…` line. This validates the underlying `FmdAuth.authenticate()` that the `testConnection` button triggers.
- [ ] 3.2 In the same shell, run `npm run ring:smoke` with a valid `FMD_DEVICE_ID` to confirm the full `FmdApi.sendRingCommand` path still works end-to-end (the test-connection success path calls the same auth flow but stops short of the ring).

## 4. Docker deploy and manual UI verification

- [ ] 4.1 Follow `CLAUDE.md` steps 1, 3, 4, 5, 6, 7: `git push`, `docker compose up -d`, `docker exec iobroker-fmd-dev iobroker url https://github.com/realrubbish/iobroker-fmd`, the directory workaround, `iobroker upload iobroker-fmd`, and the `touch` of `iobroker-data/files/iobroker-fmd/io-package.json`. Skip step 8 (the instance is already added).
- [ ] 4.2 In the browser: hard-reload ioBroker.admin, click the wrench on the `iobroker-fmd.0` instance row. Confirm the new `Test Connection` button is visible in the Connection Status panel.
- [ ] 4.3 Click `Test Connection`. Within ~2 s, the `Last Test Result` line SHALL read `OK – connected at HH:MM:SS`. Confirm.
- [ ] 4.4 Temporarily change the `password` in the form to a wrong value, click `Save`, wait for the adapter to restart, click `Test Connection` again. The line SHALL read `Failed – <reason> at HH:MM:SS` and `Last Error` SHALL match. Restore the correct password afterwards.
- [ ] 4.5 With the form open, watch the `Last Test Result` line across two consecutive 5 s polling cycles. It SHALL NOT be cleared by the cycle (success case) — confirm.
- [ ] 4.6 Tail `docker exec iobroker-fmd-dev iobroker logs iobroker-fmd --files=20` and confirm the `testConnection` message handler logs `Connection test failed: …` (or the success equivalent) when the button is clicked. No new error stacks should appear.

## 5. Documentation

- [ ] 5.1 In `docs/admin-ui.md`, add a short paragraph under the "Form" / "Connection Status" section explaining the `Test Connection` button, the reply shape it expects (`{ success, message }` / `{ error }`), and the `Last Test Result` line behavior. Cross-reference the `admin-ui` capability and the `add-test-connection-button` change.
- [ ] 5.2 In the `README.md`, find the "Configuration" section (if any) and add a one-line note: "Use the `Test Connection` button in the Status panel to verify your credentials without restarting the adapter."
