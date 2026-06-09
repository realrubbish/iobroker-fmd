## Context

- `src/main.ts` already implements `onMessage.testConnection` (lines 445, 462) which authenticates against the FMD server, calls `fmdApi.listDevices()`, and replies via `sendTo` callback with either `{ success: true, message: "Connected successfully" }` or `{ error: <reason> }`.
- The `admin-ui` capability in `openspec/specs/admin-ui/spec.md` already has a "Test Connection button is present" Requirement with two scenarios, but the live `src-admin/schema.json5` omits the `type: "sendTo"` widget (see the NOTE block in that file). This was deferred from `add-admin-ui-index-html`.
- `src-admin/App.tsx` already declares a `testResult` React state (line 39) and a `setTestResult` setter (line 125), but it is never wired to anything user-visible — the "result" is rendered off-screen (line 184-189) and never updated after a click. The infrastructure is half-built.
- The host `JsonConfig` component (from `@iobroker/json-config`) renders `type: "sendTo"` form items by calling `socket.sendTo(instance, command, data)` and rendering the response inline. Our `AdapterSocket` wrapper already exposes `sendTo` (socket.ts line 156), so the wiring is in place.

## Goals / Non-Goals

**Goals:**

- Close the deferred `Test Connection` button item: schema entry, click handler, visible result, and the delta spec that exercises it.
- Make the result visible on the form (next to the `Last Error` field, not hidden off-screen) so the user does not have to scan for it.
- Keep the existing 5 s polling loop as the source of truth for `info.connection` / `info.lastError`; the test result is an *overlay* that clears the next time live state diverges from it.

**Non-Goals:**

- No backend changes — `onMessage.testConnection` is already correct and tested by the existing `scripts/auth-smoke.mjs` + `scripts/ring-smoke.mjs` flow.
- No new capabilities in the spec — this is a pure delta to `admin-ui`.
- No persistent "test history" — the result is ephemeral and reflects only the most recent click.
- No proactive polling triggered by the user (e.g. "ping every 30 s"); the test is on-demand.

## Decisions

### D1 — Use `JsonConfig`'s `type: "sendTo"` form item, not a custom React button

The component is already in the bundle and renders the inline result automatically. Alternatives:

- Custom `Button` + a separate `socket.sendTo` call from `App.tsx`. Rejected: it would require re-implementing the form-item layout, the button-styling, the loading state, and the result placement — duplication of what `JsonConfig` already does.
- `type: "staticLink"` or `type: "text"` with a hidden iframe hack. Rejected: would not match the meta-schema and is not what the controller documents.

The "controller meta-schema validates the surrounding object more strictly than the `text` item" concern from the original NOTE in `schema.json5` is addressed by copying the working shape that `add-admin-ui-index-html` already shipped for other sendTo-style actions. We follow `@iobroker/json-config`'s `ConfigTextSendTo` definition: a top-level object with `type: "sendTo"`, `label`, `command`, and (optionally) a `result` sub-schema describing the reply.

### D2 — Schema shape (matches `ConfigTextSendTo`)

```json5
"testConnection": {
  "type": "sendTo",
  "label": "Test Connection",
  "command": "testConnection",
  "result": {
    "type:": "object",  // (per the upstream component's expected reply shape)
    "sm": 0             // 0 = show inline message after click
  }
}
```

The exact field set is to be confirmed against `@iobroker/json-config`'s `ConfigTextSendTo` type definition during implementation (Task 1.2). If the meta-schema rejects the surrounding `result` sub-object, the fallback is a `type: "sendTo"` with no `result` key, in which case `JsonConfig` uses its own default "Result: <reply>" placeholder.

### D3 — Visible "last test result" line, lives in `App.tsx` state

`testResult` is already a `useState<string>` in `App.tsx`. We:

1. Pass `onCommand` (or a similar callback the `sendTo` item supports) to `JsonConfig` so it can hand us the reply payload.
2. In that callback, format `{ success: true } → "OK – connected at HH:MM:SS"`, `{ error } → "Failed – <reason> at HH:MM:SS"`, and `setTestResult(...)`.
3. Render the result as a `staticText` line **above** the `Last Error` field, populated from `data.testResult`. The 5 s polling loop does NOT overwrite it; only the next click or a successful `info.connection` transition does.
4. Clear the line when the live `info.lastError` becomes non-empty (so a fresh runtime error wins over a stale "OK" from earlier).

### D4 — Reuse the existing `lastError` key for the inline error text

`App.tsx` already pushes `lastError: { val: err ? err.val : null }` into `data` (line 86). No new key needed; the `Test Connection` button is purely additive.

### D5 — Build artefacts are committed

Per `CLAUDE.md` step 2, `npm run build:admin` regenerates `admin/index.html`, `admin/index_m.html`, and `admin/assets/`. These are committed alongside the `src-admin/` source change. The Docker dev container has no Node toolchain at deploy time, so the committed artefacts are the only way the pop-up sees the new button.

## Risks / Trade-offs

- **[Risk] `type: "sendTo"` meta-schema rejection persists** → **Mitigation:** if the controller's meta-schema still rejects the item at build time, fall back to rendering the button as a custom React `<button>` outside of `JsonConfig` and calling `socket.sendTo` directly. The schema entry is the difference between "a JsonConfig-native button" and "an external button that calls the same sendTo wrapper"; both work. We verify against a Docker deploy during Task 2.3.
- **[Risk] Result line lingers after a fresh `info.lastError`** → **Mitigation:** D3 step 4 explicitly clears the line on a non-empty live error.
- **[Risk] User clicks `Test Connection` rapidly** → **Mitigation:** the `JsonConfig` `sendTo` widget disables the button while the call is in flight (standard behavior); the `AdapterSocket.sendTo` wrapper does not need to debounce.
- **[Risk] Backend `onMessage.testConnection` is currently only exercised via the manual `sendTo('iobroker-fmd.0', 'testConnection')` from the dev host** → **Mitigation:** Task 3.1 re-runs `scripts/auth-smoke.mjs` end-to-end, which is the same `FmdAuth.authenticate()` path the button triggers, and then issues a real `sendTo` from the smoke script's caller to confirm the message handler is reachable.

## Migration Plan

1. Edit `src-admin/schema.json5` and `src-admin/App.tsx` (Tasks 1.1 – 1.4).
2. Run `npm run build:admin` and commit the regenerated `admin/` artefacts (Task 2.1).
3. Re-run `scripts/auth-smoke.mjs` against the live FMD server (Task 3.1).
4. Apply the Docker deployment workflow from `CLAUDE.md` steps 1-7 (commit, push, `docker compose up -d`, install, fix-dir, upload, touch `io-package.json`).
5. Verify in the browser: wrench pop-up → click `Test Connection` → result appears within ~2 s.

**Rollback:** revert the commit; the `admin/` artefacts are byte-deterministic and revert cleanly. The backend `onMessage.testConnection` is unchanged, so there is no state to unwind.

## Open Questions

- The exact `result` sub-schema shape for `ConfigTextSendTo` should be confirmed by reading `@iobroker/json-config`'s TypeScript definitions during Task 1.2. If the upstream type is permissive, we ship the minimal form. If it requires a specific `sm` / `type: "panel"` shape, we follow it.
- Whether `JsonConfig` exposes an `onCommand` callback that hands back the raw reply (preferred for D3) or whether we have to subscribe via `socket.sendTo` directly. Resolved during Task 1.3 by reading the component's prop type.
