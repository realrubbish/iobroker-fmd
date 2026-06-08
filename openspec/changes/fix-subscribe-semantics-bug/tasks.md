# Tasks: Fix Subscribe-Semantics Bug (Bug I)

## 1. Investigation spike: identify the true root cause

- [ ] 1.1 Add the `debugRingTrigger` boolean config field to
  `io-package.json` (`schema.properties.debugRingTrigger`,
  default `false`). Update the Admin-UI's `src-admin/schema.json5`
  to expose the field. Commit + push + redeploy.
- [ ] 1.2 Add gated `info`-level logging in
  `src/main.ts:onStateChange` that logs every invocation with
  the ID, val, and ack flag when `debugRingTrigger` is true.
  Build, push, redeploy.
- [ ] 1.3 Reproduce the bug: with `debugRingTrigger=false` in the
  container, manually create state
  `0_userdata.0.FindMyDevice.ring.test` and set it to `true`.
  Confirm `onStateChange` does NOT fire (the bug, as observed).
- [ ] 1.4 Spike variant A: re-deploy with `debugRingTrigger=true`,
  repeat step 1.3. If the callback now fires, the issue was a
  log-level / config-flag interaction. Record result.
- [ ] 1.5 Spike variant B: change `subscribeStates` to
  `subscribeForeignStates` (cross-adapter subscribe). Build,
  push, redeploy. Repeat step 1.3. If the callback now fires,
  the issue was the namespace filter. Record result.
- [ ] 1.6 Spike variant C: explicit per-state subscribe. After
  `subscribeStates("0_userdata.0.FindMyDevice.ring.*")`, call
  `await this.getStatesAsync("0_userdata.0.FindMyDevice.ring.*")`
  and `subscribeStates` for each returned ID. Build, push,
  redeploy. Repeat step 1.3. Record result.
- [ ] 1.7 Based on 1.4–1.6, identify the root cause and write
  it in a one-paragraph note at the top of
  `openspec/changes/fix-subscribe-semantics-bug/notes.md`. If
  none of the variants work, note that and plan the polling
  fallback (D5 in design.md).

## 2. Apply the fix

- [ ] 2.1 Apply the fix corresponding to the spike's finding
  (D2 subscribeForeignStates, D3 explicit per-state, D4 timing,
  or D5 polling fallback). Update the `subscribeStates` call in
  `src/main.ts:onReady` accordingly. Document the choice in
  an inline comment above the call.
- [ ] 2.2 Build (`npm run build:tsc`), commit the source change,
  build companion (`build/main.js`), push.
- [ ] 2.3 Deploy via the standard flow: `iobroker url`,
  workaround, `iobroker upload`, `iobroker restart iobroker-fmd.0`.
- [ ] 2.4 Manually set a `0_userdata.0.FindMyDevice.ring.test`
  state to `true` in the container. Confirm `onStateChange` fires
  (log line `Ring state triggered for device: test`).

## 3. Startup self-check (always)

- [ ] 3.1 Add a `debugRingTrigger`-gated self-check to
  `onReady` (after the subscribe call and the auth-flow kickoff).
  The self-check creates a `__selftest__` state, sets it to
  `true`, waits 200 ms, and checks if a global "self-check
  fired" flag was set inside `onStateChange`.
- [ ] 3.2 On self-check success: log `Ring subscribe self-check OK`
  and clean up the test state.
- [ ] 3.3 On self-check failure: log an `error` with a clear
  message ("Ring subscribe self-check FAILED: ring state changes
  will NOT trigger ring commands") and clean up the test
  state.
- [ ] 3.4 Build, commit, push, deploy. With
  `debugRingTrigger=true` in the container, confirm the
  self-check log appears in the ioBroker logs.

## 4. Admin-UI warning when self-check fails

- [ ] 4.1 Add a new static text item in
  `src-admin/schema.json5` for the Connection Status panel:
  `ringPathWarning`, with default `text: ""`. The text is
  empty when the path is healthy and a yellow warning when
  broken.
- [ ] 4.2 In `src-admin/App.tsx`, set `ringPathWarning` based
  on a new state derived from a periodic
  `getState("iobroker-fmd.0.info.ringPathOk")` poll.
- [ ] 4.3 In `src/main.ts`, set `info.ringPathOk` to `true` on
  successful self-check and to `false` on self-check failure.
  Reset to `true` on next successful boot.
- [ ] 4.4 Build the admin UI (`npm run build:admin`), commit
  (admin source + admin build output), push, deploy. Confirm
  the warning text appears in the UI when the self-check
  fails (manually break the self-check to test).

## 5. Standalone ring smoke script

- [ ] 5.1 Create `scripts/ring-smoke.mjs` that reads
  `FMD_SERVER_URL`, `FMD_USERNAME`, `FMD_PASSWORD`,
  `FMD_RING_DEVICE_ID` from env, runs the auth flow via
  `FmdAuth.authenticate()`, then calls
  `FmdApi.sendRingCommand(deviceId)`. Exit 0 on success, 1 on
  failure, 2 on missing env.
- [ ] 5.2 Add an `npm run ring:smoke` script to `package.json`.
- [ ] 5.3 Verify the script works against the live FMD
  server: `FMD_SERVER_URL=... FMD_USERNAME=eLZo3
  FMD_PASSWORD=... FMD_RING_DEVICE_ID=test node
  scripts/ring-smoke.mjs`. Expect `OK ring sent to test`
  (the server may 404 the device ID, but the auth + dispatch
  path is the thing being tested).

## 6. Documentation

- [ ] 6.1 Update `docs/admin-ui.md` with a "Troubleshooting:
  ring trigger not firing" section that explains the
  `debugRingTrigger` flag, the self-check, and the ring-smoke
  script.
- [ ] 6.2 Update `CLAUDE.md` deployment workflow with a one-line
  note that the auth-smoke and ring-smoke scripts are the
  fastest way to debug auth / ring issues, before going through
  the full Docker rebuild.
- [ ] 6.3 Update the Admin-UI's `README.md` Configuration
  section to mention the `debugRingTrigger` field and what it
  does.

## 7. Verify end-to-end

- [ ] 7.1 In the live container, with `debugRingTrigger=true`,
  confirm the self-check log appears in `iobroker logs` and
  shows "OK".
- [ ] 7.2 Manually set `0_userdata.0.FindMyDevice.ring.test` to
  `true`. Confirm `Ring state triggered for device: test` in
  the log and a call to `FmdApi.sendRingCommand("test")`.
- [ ] 7.3 Reset `debugRingTrigger` to `false` and restart.
  Confirm the self-check is skipped and the form behaves
  normally.
- [ ] 7.4 Re-archive the previous `add-admin-ui-index-html`
  change (Tasks 7.7 and 8.2 are no longer blocked).
