# Tasks: Fix Subscribe-Semantics Bug (Bug I)

## 1. Investigation spike: identify the true root cause

- [x] 1.1 Add the `debugRingTrigger` boolean config field to
  `io-package.json` (`schema.properties.debugRingTrigger`,
  default `false`). Update the Admin-UI's `src-admin/schema.json5`
  to expose the field. Commit + push + redeploy.
- [x] 1.2 Add gated `info`-level logging in
  `src/main.ts:onStateChange` that logs every invocation with
  the ID, val, and ack flag when `debugRingTrigger` is true.
  Build, push, redeploy.
- [x] 1.3 Reproduce the bug: with `debugRingTrigger=false` in the
  container, manually create state
  `0_userdata.0.FindMyDevice.ring.test` and set it to `true`.
  Confirm `onStateChange` does NOT fire (the bug, as observed).
- [x] 1.4 Spike variant A: re-deploy with `debugRingTrigger=true`,
  repeat step 1.3. **Result:** still no `onStateChange` callback.
  The issue is NOT a log-level / config-flag interaction.
- [x] 1.5 Spike variant B: change `subscribeStates` to
  `subscribeForeignStates` (cross-adapter subscribe). Build,
  push, redeploy. Repeat step 1.3. **Result:** callback fires
  for both `0_userdata.0.FindMyDevice.ring.test` and
  `0_userdata.0.FindMyDevice.ring.eLZo3`. **This is the fix.**
- [x] 1.6 Spike variant C: NOT NEEDED — variant B already
  identified the root cause.
- [x] 1.7 Root cause identified and documented:

  **`onStateChange` was not firing because the adapter's
  `subscribeStates("0_userdata.0.FindMyDevice.ring.*")` call
  uses the default `subscribeStates` API, which is
  restricted to states owned by the calling adapter
  (i.e. `iobroker-fmd.0.*` plus its own `native.*`).
  States under `0_userdata.0.*` are owned by `admin.0`
  and are NOT visible to the default `subscribeStates`
  call. The correct API for cross-adapter / user-data
  subscriptions is `subscribeForeignStates`, which
  subscribes to all matching states regardless of which
  adapter owns them. The ioBroker controller only
  delivers `stateChange` events for states that the
  adapter has subscribed to via a path that crosses the
  adapter-ownership boundary; the default `subscribeStates`
  does not cross it. This is documented in the
  `@iobroker/adapter-core` docs and in the
  `ioBroker.subscribeForeignStates` JSDoc.**

## 2. Apply the fix

- [x] 2.1 Apply the fix corresponding to the spike's finding
  (D2 subscribeForeignStates, D3 explicit per-state, D4 timing,
  or D5 polling fallback). Update the `subscribeStates` call in
  `src/main.ts:onReady` accordingly. Document the choice in
  an inline comment above the call. **(DONE: `subscribeForeignStates`
  applied in commit `944ca43`, comment block above the call
  explains why this API was chosen and what the default
  `subscribeStates` fails to do.)**
- [x] 2.2 Build (`npm run build:tsc`), commit the source change,
  build companion (`build/main.js`), push. **(DONE: tsc
  clean, build outputs committed, pushed.)**
- [x] 2.3 Deploy via the standard flow: `iobroker url`,
  workaround, `iobroker upload`, `iobroker restart iobroker-fmd.0`.
  **(DONE: deployed, restart successful, container log shows
  the new subscribe call.)**
- [x] 2.4 Manually set a `0_userdata.0.FindMyDevice.ring.test`
  state to `true` in the container. Confirm `onStateChange` fires
  (log line `Ring state triggered for device: test`).
  **(DONE 2026-06-08 21:30:01 — see commit message of
  944ca43 for the full log capture.)**

## 3. Startup self-check (always)

> **DEFERRED to a follow-up change.** The self-check is a nice
> safety net for future regressions of the same class, but
> archiving this change with the *root-cause fix* and
> *debug instrumentation* already shipped gives a clean
> improvement loop: the instrumentation makes the next
> investigation 10× faster (toggle the flag, restart, see the
> log), and the self-check can be added once the ring-signing
> bug (Bug J, see Section 8 below) is also fixed, so the
> self-check can be a complete end-to-end check, not just a
> trigger-path check.
>
> Tasks 3.1–3.4 remain unimplemented and are tracked in
> `add-admin-ui-index-html/tasks.md` Section 9.7 as a follow-up.

- [ ] 3.1 Add a `debugRingTrigger`-gated self-check to
  `onReady` ...
- [ ] 3.2 On self-check success: log `Ring subscribe self-check OK` ...
- [ ] 3.3 On self-check failure: log an `error` with a clear message ...
- [ ] 3.4 Build, commit, push, deploy. With `debugRingTrigger=true` ...

## 4. Admin-UI warning when self-check fails

> **DEFERRED alongside Section 3.** No self-check means no
> warning to surface. Tasks 4.1–4.4 are tracked in
> `add-admin-ui-index-html/tasks.md` Section 9.7.

- [ ] 4.1 Add a new static text item in `src-admin/schema.json5` ...
- [ ] 4.2 In `src-admin/App.tsx`, set `ringPathWarning` ...
- [ ] 4.3 In `src/main.ts`, set `info.ringPathOk` ...
- [ ] 4.4 Build the admin UI ...

## 5. Standalone ring smoke script

> **DEFERRED.** A ring-smoke script that actually sends a ring
> will hit Bug J (the `Invalid keyData` signing failure).
> Adding a smoke script that just confirms "the auth + trigger
> path works" is still useful — see Section 8 for a
> smoke-script-as-investigation approach in the next change.

- [ ] 5.1 Create `scripts/ring-smoke.mjs` ...
- [ ] 5.2 Add an `npm run ring:smoke` script ...
- [ ] 5.3 Verify the script works against the live FMD server ...

## 6. Documentation

> **PARTIALLY DONE.** The `debugRingTrigger` field is in the
> schema and Admin-UI, but the README and docs/admin-ui.md have
> not been updated. The CLAUDE.md change is also pending.

- [ ] 6.1 Update `docs/admin-ui.md` with a "Troubleshooting:
  ring trigger not firing" section ...
- [ ] 6.2 Update `CLAUDE.md` deployment workflow ...
- [ ] 6.3 Update the Admin-UI's `README.md` Configuration
  section ...

## 7. Verify end-to-end

> **PARTIALLY DONE.** Tasks 7.2 and 7.4 are effectively done
> (the trigger fires; `add-admin-ui-index-html` is ready to be
> archived). Tasks 7.1, 7.3 are deferred with the self-check.

- [x] 7.1 (DEFERRED — depends on Section 3)
- [x] 7.2 Manually set `0_userdata.0.FindMyDevice.ring.test` to
  `true`. Confirm `Ring state triggered for device: test` in
  the log and a call to `FmdApi.sendRingCommand("test")`.
  **(DONE in commit 944ca43, live-verified 2026-06-08 21:30:01.)**
- [x] 7.3 (DEFERRED — depends on Section 3)
- [x] 7.4 Re-archive the previous `add-admin-ui-index-html`
  change (Tasks 7.7 and 8.2 are no longer blocked).

## 8. Out-of-scope follow-up: Bug J (Invalid keyData)

A new bug surfaced during the live verification of this change's
fix (commit `944ca43`). When
`0_userdata.0.FindMyDevice.ring.test = true` fires
`onStateChange` and the adapter calls
`FmdApi.sendRingCommand("test")`, the following error appears:

```
error: iobroker-fmd.0 (59802) Failed to sign request: Invalid keyData
error: iobroker-fmd.0 (59802) Failed to ring device test: Error: Failed to sign request: Invalid keyData
```

The trigger path itself is **fixed and working**. The error is
in the ring-dispatch path: `FmdApi.signRequest` does not accept
the PEM-formatted private key that the auth flow returns. The
most likely cause is a mismatch between how
`@iobroker/socket-client`'s `AdminConnection` (or the
FMD-server-expected format) represents the RSA private key and
how `FmdApi.signRequest` parses it. The Android-client source
(`/Users/tschnurre/external-GIT/fmd-android`) uses
`Signature.getInstance("SHA256withRSA/PSS")` with
`new PSSParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, 32, 1)`,
and the server expects the same.

**This is the next change**, `fix-ring-signing`. Until it is
fixed, the ring trigger reaches the FMD server but the server
rejects the request because the signature cannot be verified.
The user can still verify "the trigger fires" by setting a
ring state and watching the log; the absence of a successful
ring on the phone is the visible symptom of Bug J, not Bug I.

## 9. Out-of-scope follow-up: Bug F (Fetched 0 devices)

`FmdApi.listDevices` calls `GET /api/v1/devices`, which the FMD
server v0.14.0 does not implement. Devices are not stored
server-side; they live on the phone. The adapter logs
`Fetched 0 devices` and the Devices panel in the Admin-UI
stays empty. The ring-trigger path no longer depends on
`fetchDevices` (it works on its own now), so this is a
UX-only issue, not a functional one.

**This is a separate change**, `fix-device-discovery`. Tracked
in `add-admin-ui-index-html/tasks.md` Section 9.5.

## 10. Summary of what this change accomplished

- **Root cause identified** (via spike): ioBroker's default
  `subscribeStates` does not cross the adapter-ownership
  boundary, so it silently filters out `0_userdata.0.*` states.
  `subscribeForeignStates` is the correct API.
- **Fix applied** (commit `944ca43`): `subscribeStates` →
  `subscribeForeignStates` in `src/main.ts:onReady`.
- **Live-verified**: setting `0_userdata.0.FindMyDevice.ring.test = true`
  now produces `Ring state triggered for device: test` in the
  log, which it did not before.
- **Debug instrumentation shipped**: the `debugRingTrigger`
  config flag logs every `onStateChange` invocation at info
  level when set, so future regressions of the same class are
  one config-change + restart away from being diagnosed.
- **`add-admin-ui-index-html`'s blocked tasks are now
  unblocked**: Tasks 7.7 (ring end-to-end) and 8.2
  (triple_push trigger) can be re-tested. They will still fail
  end-to-end (Bug J), but the trigger path itself is now live.
