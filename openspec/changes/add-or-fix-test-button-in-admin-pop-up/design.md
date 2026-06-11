## Context

The `Test Connection` button is a hard requirement of the adapter's
admin UX. The 2026-05-31 change `add-test-connection-button` delivered
it as a custom React button rendered by `src-admin/App.tsx` *outside*
the `JsonConfig` component. The reasoning at the time was that
ioBroker's built-in `ConfigSendTo` widget uses `window.alert` to
display the reply, which is not the inline `Last Test Result` line
the spec asks for, and there is no obvious hook to redirect the
reply into a sibling `staticText` field.

That implementation depended on a precondition that the
`docs/admin-ui.md` and `add-admin-ui-index-html` change documented as
true: on admin ≥ 7.7.22, the wrench pop-up loads the adapter's
`admin/index.html` in an iframe, and the React app boots there and
owns the pop-up's body. The 2026-06-11 E2E test session proved that
precondition false on the user's current deployment: the admin SPA
renders the native `jsonConfig.json5` form, the iframe is never
loaded, `App.tsx` never boots in the pop-up, and the custom
`Test Connection` button is therefore invisible.

We have two paths to make the button visible:

1. **Path A — schema item**: add a `type: "sendTo"` jsonConfig form
   item. The native form renders it with the built-in
   `ConfigSendTo` widget, which calls `sendTo("testConnection", ...)`
   and shows the reply via `window.alert`. The downside: no inline
   `Last Test Result` line, no timestamp formatting, no 12-second
   timeout (the spec changes around the 12s timeout in
   `cleanup-bugs-and-admin-robustness` task 3 are then moot in the
   native form).

2. **Path B — keep the iframe-path implementation and accept the
   regression on admin 7.7.22**: the button works for the (currently
   hypothetical) future admin version that does take the iframe
   path; on 7.7.22 the user has to load the standalone SPA URL to
   get the button. This is the current state.

The chosen approach is **Path A + a guarded Path B**: add the
schema item so the button is reachable in the form the user
actually sees, and keep the App.tsx button as a fallback that is
inert when the schema item is present.

## Goals / Non-Goals

**Goals:**

- Make the `Test Connection` button reachable from the wrench
  pop-up on the user's current deployment (admin 7.7.22, js-controller
  7.1.2, native jsonConfig form).
- Preserve the inline `Last Test Result: OK – connected at HH:MM:SS`
  formatting for the future admin version that takes the iframe
  path.
- Preserve the 12-second `Promise.race` timeout in App.tsx for the
  iframe path.
- Keep the adapter-runtime `onMessage.testConnection` handler in
  `src/main.ts` as the single source of truth for the auth round-trip.

**Non-Goals:**

- Re-investigate the admin SPA's iframe decision. The
  `admin-ui-investigation-2026-06-08.md` and the
  `admin-ui.md` "Known limitation" block track that as a separate
  follow-up. This change makes the button work *despite* that gap;
  it does not close the gap.
- Add a new sendTo message. The `testConnection` message and its
  handler are unchanged.
- Migrate away from the `JsonConfig` form. The schema-driven form
  remains the source of truth; App.tsx is a thin override layer
  only.

## Decisions

### Decision 1: Add a `type: "sendTo"` form item to `src-admin/schema.json5`

**Why:** This is the surface ioBroker.admin 7.7.22 actually renders.
Adding the schema item costs one block of JSON5 and makes the
button reachable in the deployed form. The `ConfigSendTo` widget
already calls `socket.sendTo("testConnection", {})` and shows the
reply via `window.alert`; the existing adapter-side
`onMessage.testConnection` handler returns the result in the shape
the widget expects (`{ success: true, message: "..." }` or
`{ error: "..." }`).

**Alternative considered:** Render the button as a
`type: "customSendTo"` with a custom React component that does
both the sendTo and the inline formatting. Rejected: the admin
form's `customSendTo` is meant for the iframe path where we own
the rendering, which is precisely the path that is broken on 7.7.22.

### Decision 2: Add a `type: "staticText"` `Last Test Result` line as a sibling of `Last Error`

**Why:** The spec calls for the line to be visible. The
`ConfigSendTo` widget does not write its reply to a sibling
`staticText`; it shows the reply in `window.alert`. The `Last Test
Result` `staticText` line therefore shows the placeholder
`(click Test Connection to run)` in the native form and gets
populated only in the iframe path by `App.tsx`. The user sees the
button click results via the alert on 7.7.22 and via the inline
line on the future iframe path.

**Alternative considered:** Drop the staticText line entirely for
the native form. Rejected: the spec requires it, and removing it
would be a regression in the iframe path.

### Decision 3: Guard the App.tsx custom button so it does not double-render

**Why:** If both the schema item and the App.tsx button render in
the iframe path, the user sees two `Test Connection` buttons. The
guard is a one-line conditional: render the App.tsx button only
when the surrounding form is the React one (i.e. the iframe path
is active). We detect the iframe path by checking that the
`JsonConfig` component is mounted *inside* `App.tsx` (which is
always true in the current code). The guard's actual trigger is
"the form schema includes a `type: "sendTo"` item" — if the
schema has the item, the App.tsx button is suppressed. This makes
the App.tsx button strictly a fallback for the future admin
version where the iframe path is taken and the schema item is
*not* present (which, with this change, will not be the case in
this adapter's own build, but might be the case in a fork).

**Alternative considered:** Remove the App.tsx button entirely
and rely on the schema item + `ConfigSendTo` widget. Rejected:
the inline formatting with timestamp and the 12s timeout are
explicit non-goals of this change but valuable for the iframe
path. Keeping the App.tsx button as a guarded fallback costs
~5 lines and preserves the option.

### Decision 4: Update `docs/admin-ui.md` Known limitation and `docs/docker-development.md` verify step

**Why:** The Known limitation block currently says "to exercise
the Test Connection timeout, load the standalone SPA URL". After
this change that workaround is no longer needed for the button
itself; the in-pop-up button works. The workaround remains useful
for the timeout itself (which is gated behind the iframe path).
The docker-development verify step should mention clicking the
in-pop-up button.

## Risks / Trade-offs

- **Risk:** The `ConfigSendTo` widget shows the reply via
  `window.alert`, which is a less polished UX than the inline
  `Last Test Result` line. **Mitigation:** the spec already
  accepts this trade-off (it is the existing behavior in
  ioBroker.admin and we are not changing it); the App.tsx fallback
  path delivers the inline line for users on a future admin
  version that takes the iframe path.

- **Risk:** The 12-second `Promise.race` timeout in App.tsx is
  only active in the iframe path, so on admin 7.7.22 a hung
  `testConnection` will block the button until the native widget
  gives up. **Mitigation:** the adapter's
  `onMessage.testConnection` handler does not block on the
  network call indefinitely; it goes through `FmdAuth.authenticate`
  which has its own internal timeouts. The 12s timeout is
  defensive in depth; the native widget's lack of it is
  acceptable for the deployed admin version.

- **Risk:** Schema change in `src-admin/schema.json5` requires a
  rebuild (`npm run build:admin`) and a re-upload
  (`iobroker upload iobroker-fmd`) in the dev container. **Mitigation:**
  the deployment workflow in `docs/docker-development.md` and
  `CLAUDE.md` §"Deployment & Testing Workflow" already calls for
  both steps; this change adds nothing new.

- **Risk:** The double-render guard (Decision 3) is fragile. If
  the schema item is removed in a future change, the App.tsx
  button will silently take over, and the UX will be inconsistent
  (one path with timestamp, one without). **Mitigation:** the
  guard logic is colocated with both the schema item and the
  App.tsx button; a future reviewer who removes one will see the
  other. A unit test in `src-admin/App.tsx`'s comment header
  documents the expectation.

## Migration Plan

This is a config-only change to the admin UI. No data migration
required.

Deploy:

1. Update `src-admin/schema.json5` to add the `type: "sendTo"`
   item and the `Last Test Result` `staticText` line in the
   Status panel.
2. Update `src-admin/App.tsx` to guard the custom button.
3. Run `npm run build:admin` to regenerate `admin/`.
4. Commit, push, follow the existing dev-container workflow
   (`docs/docker-development.md`).

Rollback: revert the schema change and re-run `npm run build:admin`.
The App.tsx button reverts to its previous behavior (always
rendered, which was the state before this change). No data is
affected.

## Open Questions

- Does the `ConfigSendTo` widget honour the `disabled` field, or
  does the user need to wait for the previous reply to clear
  before clicking again? If the widget has its own busy state,
  the App.tsx guard logic in Decision 3 may need to also check
  `socket.isLive` to avoid double-clicks.
- Is the reply shape `{ success, message }` exactly what
  `ConfigSendTo` expects, or does it want a flat string? The
  existing `onMessage.testConnection` returns
  `{ success: true, message: "..." }` / `{ error: "..." }`. We
  will need to test the live reply shape in the dev container to
  confirm the alert shows a useful string rather than `[object
  Object]`.
