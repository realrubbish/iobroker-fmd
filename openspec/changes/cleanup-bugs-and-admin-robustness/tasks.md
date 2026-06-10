# Tasks: cleanup-bugs-and-admin-robustness

## 1. Remove dead `__selftest__` ring filter and `selfCheckFiredAt` field

- [x] 1.1 In `src/main.ts`, delete the `public static selfCheckFiredAt: number | undefined = undefined;` declaration (currently around line 37) and the JSDoc block above it that references "Task 3.1 in fix-subscribe-semantics-bug". The field has no reader in the codebase (verified during the code review).
- [x] 1.2 In `src/main.ts` `onStateChange`, delete the `__selftest__` match arm (the `if (deviceId === "__selftest__" && state.val === true)` block plus the `FmdAdapter.selfCheckFiredAt = Date.now();` write and the `[self-check]` log line). The remaining `ringMatch && state.val === true` block below it continues to dispatch the real ring for all other deviceIds.
- [x] 1.3 Verify that after the deletion, the only `selfCheckFiredAt` and `__selftest__` references in the repo are in `openspec/changes/archive/2026-06-08-fix-subscribe-semantics-bug/` (historical). Grep `src/`, `scripts/`, `src-admin/` for both strings; expect zero matches.

## 2. Add `hasValidTokens()` short-circuit at the four `authenticate()` call sites

- [x] 2.1 In `src/main.ts` `connectAndFetchDevices()` (around line 122), wrap the `this.fmdAuth.authenticate()` call in a `hasValidTokens()` check. Pattern: `if (this.fmdAuth.hasValidTokens()) { this.authTokens = this.fmdAuth.getTokens()!; } else { this.authTokens = await this.fmdAuth.authenticate(); }`. The `getTokens()!` non-null assertion is safe because `hasValidTokens()` is true only when `cachedTokens` is set.
- [x] 2.2 In `src/main.ts` `fetchDevices()` (around line 215), replace the existing `if (!this.authTokens)` short-circuit (which only checks the adapter-side variable) with a `hasValidTokens()`-based short-circuit that consults `FmdAuth`'s cache and `expiresAt`. The new pattern matches task 2.1.
- [x] 2.3 In `src/main.ts` `onMessage.testConnection` (around line 470), wrap the `this.fmdAuth.authenticate()` call in the same `hasValidTokens()` check. This is the user-initiated test path; reusing cached tokens is the right semantics because the user is asking "do my cached credentials still work", not "force a fresh auth".
- [x] 2.4 In `src/main.ts` `onMessage.sendRingCommand` (around line 525), replace the existing `if (!this.authTokens)` short-circuit with the `hasValidTokens()`-based short-circuit. The admin-UI ring-trigger path is the highest-leverage site for the short-circuit (it is the most latency-sensitive).
- [x] 2.5 Confirm `tsc --noEmit` passes (the project uses strict TypeScript; the non-null assertion in the pattern is sound but `tsc` will check it).
- [x] 2.6 Sanity-check that `FmdAuth.hasValidTokens()` returns `false` on first call (cachedTokens undefined) and `true` after a successful `authenticate()` (cachedTokens set with future `expiresAt`). Read `src/lib/fmd-auth.ts:83-89` to confirm the check is correct.

## 3. Add 12-second client-side timeout to the admin-UI Test Connection button

- [x] 3.1 In `src-admin/App.tsx`, add a `const TEST_CONNECTION_TIMEOUT_MS = 12_000;` constant near the top of the file (next to the existing `POLL_INTERVAL_MS` and `TEST_RESULT_PLACEHOLDER` constants).
- [x] 3.2 In `handleTestConnection`, wrap the `await socket.sendTo(...)` call in a `Promise.race` against a `setTimeout` that rejects with a tagged `Error("testConnection timeout")`. On timeout the catch arm must format `setTestResult(\`Failed – timed out after 12s at ${now}\`)` and `console.warn` for in-browser diagnostics.
- [x] 3.3 Confirm that on timeout the `finally` block at the end of `handleTestConnection` still runs (it must — that is the only place `setTestRunning(false)` is called). The `Promise.race` rejection must propagate to the existing `catch` arm, not to an unhandled-promise rejection.
- [x] 3.4 Verify that a non-timeout failure (reply with `{ error: "..." }` or a thrown exception from `sendTo`) still flows through the existing error-formatting path unchanged. The new code path is purely additive.

## 4. Switch admin-UI fresh-error detection from string equality to `err.lc`

- [x] 4.1 In `src-admin/App.tsx` (around line 100-107 in the poll effect), replace the `errVal` string-equality dedup with an `err.lc` (lastChanged) dedup. The polled state object from `socket.getStates([...])` carries `lc` alongside `val`; treat `undefined` `lc` as `null`. The new condition is `if (errLc !== null && lastErrorRef.current !== errLc) { setTestResult(TEST_RESULT_PLACEHOLDER); }`.
- [x] 4.2 Rename the ref from `lastErrorRef` to `lastErrorLcRef` (or similar) to reflect the new key. Update the declaration at line 64 and the assignment at the new line.
- [x] 4.3 Confirm that the `errVal` variable (used in the `setData({ ..., lastError: { val: errVal } })` call further down in the same effect) is still populated from `err.val` for the JsonConfig `Last Error` field rendering. The change is local to the dedup logic; the value pushed to the form does not change.

## 5. Build, deploy, and verify

- [x] 5.1 Run `npm run build:tsc` to confirm both the runtime TypeScript and the admin-side TypeScript compile cleanly. The `tsc --noEmit` from task 2.5 is a sub-check of this.
- [ ] 5.2 Run `npm run auth:smoke` against the dev FMD server (`FMD_SERVER_URL=https://fmd.example.com FMD_USERNAME=… FMD_PASSWORD=…`) to confirm the auth path still works end-to-end after the `hasValidTokens()` short-circuit is in place. A successful run prints the access-token length line and exits 0. *(user-owned: requires FMD credentials)*
- [ ] 5.3 Run `npm run ring:smoke:verify` for the offline sign-then-verify round-trip. It does not exercise the changes (the sign path is unchanged) but is the cheap belt-and-braces check. *(user-owned: needs `npm run build:tsc` artefacts + signer script)*
- [ ] 5.4 Run `npm run ring:smoke` against the dev FMD server to confirm a real ring end-to-end still works. The ring path is unchanged by this change but the smoke test is the documented Step 0 of the deployment workflow in CLAUDE.md. *(user-owned: requires FMD credentials + device ID)*
- [x] 5.5 Run `npm run build:admin` to regenerate `admin/index.html` and `admin/index_m.html` (the Test Connection timeout change lives in `src-admin/App.tsx`).
- [ ] 5.6 Smoke-test the admin UI in a browser: open the wrench pop-up, click `Test Connection` once, confirm the OK line shows. Then either (a) stop the adapter with `iobroker stop iobroker-fmd.0` and click Test Connection again, or (b) point the adapter at a black-hole server URL — either way, confirm the timeout fires within ~12s and the button is re-enabled. *(user-owned: requires running ioBroker admin)*
- [ ] 5.7 Smoke-test the `err.lc` change: in the admin UI, click Test Connection to get an OK line. Then trigger a `setState` on `system.adapter.iobroker-fmd.0.info.lastError` to a non-empty string (e.g. via the Objects tab). Confirm the OK line is cleared on the next 5s polling cycle. Then set `info.lastError` to the SAME string again (without changing it) and confirm the OK line stays cleared (because `lc` advanced, the second write is a fresh transition). *(user-owned: requires running ioBroker admin)**

## 6. Commit and ship

> Per `CLAUDE.md` ("NEVER auto-commit or auto-push") and the project
> OpenSpec rule ("only implement features in an approved change"), the
> git operations and the Docker dev cycle below are user-owned. The
> agent must stage, commit, and push the source + artefacts, then
> hand off; the user runs the install / upload / touch / verify steps.

- [ ] 6.1 *(user-owned)* Stage `src/main.ts`, `src/lib/fmd-auth.ts` (no functional change but the refactor is contiguous), `src-admin/App.tsx`, the regenerated `admin/` artefacts from task 5.5, and the four openspec change artefacts (`proposal.md`, `design.md`, `specs/**/*.md`, `tasks.md`).
- [ ] 6.2 *(user-owned)* Commit with a Conventional Commits message of the form `fix(adapter): cleanup dead __selftest__ scaffolding + cache valid auth tokens + Test Connection timeout`. Co-author line per project convention.
- [ ] 6.3 *(user-owned)* Push the branch.
- [ ] 6.4 *(user-owned)* Run the Docker dev cycle from `CLAUDE.md` § "Deployment & Testing Workflow": build the admin UI (`npm run build:admin` is a no-op after task 5.5), bring the container up, install the adapter from GitHub, apply the directory workaround, upload, and refresh the `io-package.json` cache via `touch`. Verify the admin wrench pop-up loads the new `admin/index.html`.
