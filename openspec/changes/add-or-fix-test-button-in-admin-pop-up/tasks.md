# Tasks: add-or-fix-test-button-in-admin-pop-up

## 1. Add `type: "sendTo"` form item to the schema

- [x] 1.1 In `src-admin/schema.json5`, locate the Status panel (sibling of the `Connection` and `Hardware Button Trigger` panels). Add a new form item `testConnection` of `type: "sendTo"`, `label: "Test Connection"`, `command: "testConnection"`, placed in the Status panel between the `connectionState` and `lastError` items. The form item SHALL not require any additional fields; the `sendTo` payload is the empty object (the adapter-side handler does not consume one).
- [x] 1.2 In `src-admin/schema.json5`, confirm the `lastTestResult` `type: "staticText"` item already exists in the Status panel directly below `lastError` with the placeholder text `(click Test Connection to run)`. If it is missing (regression from a previous change), add it back with the same placeholder. Verify it is the LAST item in the Status panel so it renders directly below the `Last Error` field per the spec.
- [x] 1.3 In `src-admin/schema.json5`, re-read the full Status panel and confirm the form does not introduce duplicate `Test Connection` controls. The schema-level `sendTo` item plus the existing `App.tsx` custom button are the two paths; only the schema item is rendered in the native form. The custom button's double-render guard is wired in step 2.

## 2. Guard the App.tsx custom button so it does not double-render

- [x] 2.1 In `src-admin/App.tsx`, find the `handleTestConnection` callback (around line 168 in the current file) and the `<!-- Visible Test Connection button -->` block (around line 268-286). Add a guard so the custom button is rendered ONLY when the surrounding form is the React one AND the schema item from step 1.1 is NOT present. Concretely: pass a `hasSchemaTestConnection` prop to `App` (computed in `main.tsx` from the same `jsonConfigSchema` constant) and gate the custom button on `!hasSchemaTestConnection`. The schema check is done once at module load; the boolean is constant for the lifetime of the app.
- [x] 2.2 In `src-admin/App.tsx`, update the comment header on the custom button to record the new contract: "The custom button is a fallback for future admin versions that take the iframe path AND that have been forked to remove the `type: \"sendTo\"` schema item. The main path is the schema item, which is rendered in both the native form (admin 7.7.22) and the iframe path."
- [x] 2.3 Confirm the inline `Last Test Result: <msg> at HH:MM:SS` formatting, the 12s `Promise.race` timeout, the `err.lc` dedup, and the `(click Test Connection to run)` placeholder behaviour for the iframe path all still work. The change in 2.1 is a render guard only; the existing logic is untouched. Run a typecheck (`npm run build:tsc`) to confirm.

## 3. Build the admin UI

- [x] 3.1 Run `npm run build:admin` to regenerate `admin/index.html`, `admin/index_m.html`, `admin/assets/`, and `admin/jsonConfig.json5` from the updated `src-admin/`. Confirm the build script copies the new `src-admin/schema.json5` (with the `sendTo` item) to `admin/jsonConfig.json5` and the regenerated `index.html` still references the Vite entry script correctly.
- [x] 3.2 Open `admin/jsonConfig.json5` after the build and verify it contains the new `testConnection` `type: "sendTo"` item and the `lastTestResult` `type: "staticText"` placeholder. The file is the source the admin SPA reads at runtime, so this verification is the one that proves the build worked.

## 4. Update project docs

- [x] 4.1 In `docs/admin-ui.md`, find the "Known limitation: admin 7.22 SPA renders native form" section. Update the "Workarounds for testing the SPA features manually while the iframe path is broken" list: remove the "Test Connection" entry that pointed at the standalone SPA URL, since the in-pop-up button now works on the native form. Replace it with: "Test Connection is now reachable in the native form via the `type: \"sendTo\"` schema item. The reply is shown via `window.alert` (the ioBroker admin default). The 12s timeout and the inline `Last Test Result: <msg> at HH:MM:SS` formatting remain gated behind the iframe path." Keep the Ring trigger workaround entry as-is.
- [x] 4.2 In `docs/docker-development.md`, find the verify step ("Verify it Works"). Add a one-line note: "Click the `Test Connection` button in the wrench pop-up. The reply is shown via `window.alert` on admin 7.7.22 (native form) and inline on admin versions that take the iframe path."
- [x] 4.3 In `docs/admin-ui-investigation-2026-06-08.md`, find the "Status update (2026-06-11)" section. Replace the sentence "The Test Connection button, the live `0_userdata.0.FindMyDevice` device panel, and the `App.tsx`-managed layout are all missing from the pop-up" with: "The Test Connection button was missing from the pop-up; this change (`add-or-fix-test-button-in-admin-pop-up`) adds it back via a `type: \"sendTo\"` schema item, reachable in the native form. The live `0_userdata.0.FindMyDevice` device panel and the `App.tsx`-managed layout remain gated behind the iframe path and are tracked as a separate follow-up."

## 5. Deploy and verify in the dev container

> Per `CLAUDE.md` ("NEVER auto-commit or auto-push") and the OpenSpec
> rule that agents only implement features from an approved change, the
> git operations and the Docker dev cycle below are user-owned. The
> agent must stage, commit, and push the source + artefacts, then
> hand off; the user runs the install / upload / touch / verify steps.

- [ ] 5.1 *(user-owned)* Stage `src-admin/schema.json5`, `src-admin/App.tsx`, the regenerated `admin/` artefacts from task 3.1, and the four openspec change artefacts (`proposal.md`, `design.md`, `specs/admin-ui/spec.md`, `tasks.md`).
- [ ] 5.2 *(user-owned)* Commit with a Conventional Commits message of the form `fix(admin-ui): make Test Connection button reachable in the native form`. Co-author line per project convention.
- [ ] 5.3 *(user-owned)* Push the branch.
- [ ] 5.4 *(user-owned)* Run the Docker dev cycle from `CLAUDE.md` § "Deployment & Testing Workflow": bring the container up, install the adapter from GitHub, apply the directory workaround (re-apply if a `maintenance upgrade` wiped it — see `docs/docker-development.md`), upload, refresh the `io-package.json` cache via `touch`, and add or restart the instance.
- [ ] 5.5 *(user-owned)* Open the wrench pop-up at http://localhost:8081. Verify the `Test Connection` button is now visible in the Status panel. Click it. Verify the reply is shown via `window.alert` (or via the inline `Last Test Result` line if the admin version takes the iframe path). Confirm the adapter logs show `FMD authentication successful` or the appropriate failure message.
- [ ] 5.6 *(user-owned)* Run `npm run auth:smoke` against the dev FMD server to confirm the underlying auth path is still healthy after the schema change. (The smoke test does not exercise the schema change; it is a belt-and-braces check that nothing in the jsonConfig update broke the build-time imports.)

## 6. Archive the change

- [ ] 6.1 *(user-owned)* After the verify step (5.5) confirms the button is reachable, run `/opsx:archive` to archive the change. The archive process syncs the `admin-ui` capability delta spec to `openspec/specs/admin-ui/spec.md` and moves the change folder under `openspec/changes/archive/`. The 2026-06-11 "Status update" block in `docs/admin-ui-investigation-2026-06-08.md` (edited in task 4.3) will become the "post-archive" entry point for future readers.
