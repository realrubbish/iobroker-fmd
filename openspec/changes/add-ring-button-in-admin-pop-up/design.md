## Context

The ioBroker-fmd adapter is a daemon that subscribes to a Shelly hardware button (`shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event` = `triple_push`) and to a `0_userdata.0.FindMyDevice.ring.*` state tree, and on either trigger calls the FMD server's ring command. The adapter-runtime code in `src/main.ts` already exposes this dispatch through two paths:

- **Hardware path**: the `onStateChange` handler at `src/main.ts:348-391` reads the `buttonStateId` and `ringDeviceId` config fields and calls `triggerRing(ringDeviceId)` on `triple_push`.
- **Software path**: the same handler at `src/main.ts:386-390` watches the `0_userdata.0.FindMyDevice.ring.<deviceId>` state tree and calls `triggerRing(deviceId)` when set to `true`.

The adapter also has a `onMessage.ring` sendTo handler at `src/main.ts:505-555` that accepts a `{ deviceId }` payload and dispatches the same `triggerRing(deviceId)`. This handler is unused in production today (no UI surfaces it).

The 2026-06-11 E2E test session established three facts that shape this change:

1. **The deployed admin stack renders the native form**, not the Vite SPA. The wrench pop-up calls `validate_config/iobroker-fmd` and shows a native `jsonConfig.json5`-driven form with `Save` / `Save and Close` / `Close` buttons and the standard `v0.0.1` header. The iframe path documented in `docs/admin-ui.md` is not taken on admin 7.7.22.
2. **The native form supports a `type: "sendTo"` form item** that is rendered as a button by the built-in `ConfigSendTo` widget. The widget calls `socket.sendTo(adapterName.instance, command, payload)` on click and shows the reply via `window.alert`. The button is reachable in the pop-up.
3. **The `display` property on a `staticText` `val` push is rejected** by the jsonConfig meta-schema. A single invalid item in a panel causes the admin SPA to skip the whole panel — discovered during the previous change's E2E test. The `connectionState` push in `App.tsx` is the offender and must stay display-free.

The previous change `add-or-fix-test-button-in-admin-pop-up` (commit 72dc1bf) shipped a `Test Connection` sendTo item. The user has now redirected: the pop-up button should send the **ring** command instead, because the ring trigger is the most common operation and the user already has the auth path covered by the adapter's startup log + the `info.connection` state.

## Goals / Non-Goals

**Goals:**

- Add a `Ring Device` button to the Status panel of the native admin form, rendered by the built-in `ConfigSendTo` widget.
- Wire the click to the existing `onMessage.ring` handler in `src/main.ts:505-555`, passing `{ deviceId: config.ringDeviceId }` so the ring handler knows which device to ring.
- Surface the handler's reply via `window.alert` (the ConfigSendTo widget default), matching the precedent set by the test-connection path.
- Keep the `App.tsx` `display`-fix from the previous change (the working-tree edit that never made it into a commit) so the Status panel renders cleanly.
- Keep the custom `<button>` fallback in `App.tsx` for the iframe path, gated on a renamed `hasSchemaRingNow` constant. The fallback would also call the `ring` sendTo with the configured deviceId.

**Non-Goals:**

- Re-investigating why admin 7.7.22 does not take the iframe path. Tracked separately in `docs/admin-ui.md` §"Known limitation".
- Restoring the `Test Connection` capability in any form. The smoke test path for auth remains the `npm run auth:smoke` script and the adapter's `info.connection` state; the GUI no longer needs a dedicated test button.
- Refactoring the `triggerRing` helper in `src/main.ts`. The change is at the schema + UI layer; the runtime dispatch is unchanged.
- Rewriting the open `commit 72dc1bf` ("Test Connection") commit. Per CLAUDE.md ("NEVER auto-commit or auto-push — only when user explicitly tells you to" + "NO `git commit --amend`"), the previous commit stays as-is on `main` until the user decides to revert it via a follow-up commit.

## Decisions

### Decision 1: Send `{ deviceId: config.ringDeviceId }` as the sendTo payload

**Why:** The `onMessage.ring` handler accepts `obj.message?.deviceId` and dispatches the ring. Passing the configured `ringDeviceId` directly is the simplest wiring. The ConfigSendTo widget serializes the payload as the third argument to `socket.sendTo`, and the handler already parses it as `JSON.parse`-able.

**Alternative considered:** Read `config.ringDeviceId` at the click handler side in the admin SPA. Rejected — the adapter-runtime is the single source of truth for the deviceId (it knows the live config, the SPA is read-once on mount), and we already have the path: payload → handler → `triggerRing`.

### Decision 2: Drop the `lastTestResult` staticText placeholder

**Why:** The placeholder was paired with the testConnection button to show a timestamped result. The ring path returns its reply via `window.alert` (the ConfigSendTo widget default), and there is no need for a staticText line. Removing the placeholder simplifies the schema and removes the only "test-specific" UI from the Status panel.

**Alternative considered:** Keep the line and rename it to `lastRingResult` so the SPA path can still surface a timestamped result. Rejected: the ConfigSendTo widget reply shape (`{ success, message }` / `{ error }`) is consumed by `window.alert`, and the SPA's custom button (gated by `hasSchemaRingNow`) has its own poll-loop / setTestResult path that we could rename, but the placeholder is unused in both paths. Adding it for a single path is not worth the extra schema weight.

### Decision 3: Rename `hasSchemaTestConnection` → `hasSchemaRingNow` and re-target the probe

**Why:** The constant is the App.tsx-side guard that prevents the custom button from double-rendering alongside the schema item. Renaming tracks the new action and keeps the variable's intent obvious to future readers. The probe shape is unchanged (walks `jsonConfigSchema.items.status.items.ringNow.type === "sendTo"`).

**Alternative considered:** Generalize the constant to `hasSchemaItemAtStatusPath(key: string)` and reuse it for both test-connection and ring. Rejected: there is only one such item now (the test-connection slot is gone); generalization would be premature abstraction.

### Decision 4: Carry forward the `display`-property fix from local working tree

**Why:** Commit `72dc1bf` (the test-connection change) was pushed without the `display` fix. The fix exists in the local `App.tsx` working tree from the 2026-06-11 E2E session. Leaving it un-committed means the next time the user pulls `main` and re-runs the dev container, the Status panel will silently disappear again (the previous change's intent — making the button visible — is undermined). Re-applying the fix in the same change as the ring button keeps the visible-Status-panel invariant intact.

**Alternative considered:** Submit the `display` fix as a separate `fix(admin-ui): remove invalid display property` commit. Cleaner, but requires an additional commit cycle and the user has to verify it separately. Combining keeps the deployment story as "one change, one redeploy".

### Decision 5: Rename button label from "Test Connection" to "Ring Device"

**Why:** The label must describe the action. "Test Connection" was wrong for the test (we removed it) and would be doubly wrong for the ring action. "Ring Device" is the consensus pick from the user — descriptive, clear, no conflict with the existing "Default Ring Device" config field name.

**Alternative considered:** "Ring Now" (more imperative), "Trigger Ring" (more verbose). "Ring Device" won the user vote.

## Risks / Trade-offs

- **[Risk]** The native `ConfigSendTo` widget's `window.alert` UX is unpolished compared to a custom inline result. **Mitigation**: documented in `docs/admin-ui.md` §"Known limitation"; the SPA-path fallback (`App.tsx` custom button) provides the better UX for future admin versions.
- **[Risk]** The button fires on the **configured** `ringDeviceId`, not a user-chosen device. If the user wants to ring a different device from the form, they must edit the config and save first. **Mitigation**: the existing "Default Ring Device" config field is right above the button in the form (next panel over), so the "edit and save" flow is discoverable. A future change could add a per-form device picker; out of scope here.
- **[Risk]** Calling `socket.sendTo("iobroker-fmd.0", "ring", { deviceId: "" })` would dispatch an empty deviceId to the ring handler. The handler does not currently reject empty deviceIds (it would call `triggerRing("")` and likely fail at the FMD server with a 4xx). **Mitigation**: leave the empty-deviceId check to the adapter-runtime (out of scope for this change); document the user-flow in `docs/docker-development.md` ("set the Default Ring Device first, then click Ring Device").
- **[Risk]** The `display` fix in `App.tsx` is being applied in the same commit as the ring-button schema change. If the display fix introduces a regression, the diff is harder to bisect. **Mitigation**: the fix is a one-line deletion + a comment block; a regression would surface as an immediate "no status info" symptom in the admin pop-up, not a silent failure.

## Migration Plan

This is a config-only change to the admin UI. No data migration required. Deploy:

1. Update `src-admin/schema.json5` — replace `testConnection` item with `ringNow`, drop `lastTestResult` staticText, update header comment.
2. Update `src-admin/App.tsx` — rename `hasSchemaTestConnection` → `hasSchemaRingNow`, rename custom button, apply `display` fix, update call to `socket.sendTo("ring", { deviceId })`.
3. Run `npm run build:admin` to regenerate `admin/`.
4. Commit, push, follow the existing dev-container workflow (`docs/docker-development.md`).
5. In the browser, hard-reload the wrench pop-up for `iobroker-fmd.0`. The "Ring Device" button is now visible in the Status panel.
6. Click the button. The adapter logs `Ring state triggered for device: <ringDeviceId>` and the phone rings within ~2 seconds.

**Rollback**: revert the schema item to the previous `testConnection: { type: "sendTo", command: "testConnection" }` (the test-connection path is still wired in the adapter handler and would re-engage the previous behavior). Re-run `npm run build:admin`. No data is affected; the `display` fix is independent and should be kept even on rollback.

## Open Questions

- Does the native `ConfigSendTo` widget on admin 7.7.22 surface the reply via `window.alert` reliably, or does it silently swallow the reply as the 2026-06-11 E2E session suggested? The new ring action has a **visible side effect** (the phone rings), so a silent `window.alert` is acceptable — the user hears the ring, not the alert. The previous test-connection path had no side effect, which made the silent alert confusing.
- Should the `onMessage.ring` handler be hardened to reject empty `deviceId`? Not in scope here, but a future quality-of-life change.
- Does the configured `ringDeviceId` survive a save-then-edit-then-save cycle, or does the ioBroker controller trim the encrypted `protectedNative` field? Out of scope; the existing 2026-06-11 E2E confirmed the field persists.
