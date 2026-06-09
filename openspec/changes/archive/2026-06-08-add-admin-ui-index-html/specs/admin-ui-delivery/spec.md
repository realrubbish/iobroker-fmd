## ADDED Requirements

### Requirement: admin/ directory contains the required artefacts
The `admin/` folder at the root of the repository SHALL contain at least the following files for a working wrench pop-up under ioBroker.admin 7.7.22:

- `index.html` — entry point for the non-materialize admin iframe
- `index_m.html` — entry point for the materialize admin iframe
- `jsonConfig.json5` — canonical form schema consumed by `index.html` at runtime
- `settings.json` — kept on disk for backward compatibility; the rendered form does not read it
- `assets/` — Vite-built JS/CSS bundles referenced by `index.html` and `index_m.html`
- A favicon (e.g. `favicon.ico` or `favicon.svg`) — required to avoid a 404 in the browser network panel

#### Scenario: All required artefacts are present
- **WHEN** the repository is cloned and `npm run build:admin` has been run
- **THEN** the `admin/` directory contains every file listed above
- **AND** the `index.html` file size is > 0 bytes
- **AND** the `assets/` directory is non-empty

#### Scenario: Missing index.html causes 404
- **WHEN** `admin/index.html` is missing
- **AND** the user clicks the wrench on the `iobroker-fmd.0` instance
- **THEN** the browser logs `GET /adapter/iobroker-fmd/index.html?... 404`

### Requirement: io-package.json adminUI flags are wired
The `io-package.json` `common.adminUI` block SHALL set:

- `config = "json"` so the Instances list and the sidebar adapter tab use the native jsonConfig form (no iframe for those surfaces)
- `tab` SHALL NOT be set. The admin SPA's `Config-*.js` only takes the direct-to-`index.html` / `index_m.html` branch when `adminUI.tab` is unset. Setting `tab` (to `"html"`, `"materialize"`, or anything else) makes the loader probe for `tab.html` / `tab_m.html`, which we do not ship, and breaks the wrench pop-up with a `Cannot find tab(_m).html` alert.

The adapter SHALL NOT set `adminUI.tab = "materialize"` (that would load a different code path and require shipping `tab_m.html`).

#### Scenario: adminUI flags are set
- **WHEN** the adapter is installed
- **THEN** `io-package.json` contains `common.adminUI.config === "json"`
- **AND** `io-package.json` does NOT contain a `common.adminUI.tab` field

#### Scenario: adminUI changes are picked up after upload
- **WHEN** the developer changes an `adminUI` flag and runs `iobroker upload iobroker-fmd`
- **THEN** the controller does NOT pick up the change on its own (known controller behavior)
- **AND** the deployment workflow in `CLAUDE.md` documents the manual `touch` of `iobroker-data/files/iobroker-fmd/io-package.json` to force a refresh

### Requirement: The admin assets are built by `npm run build:admin`
The repository SHALL provide an `npm run build:admin` script that produces a fresh `admin/index.html`, `admin/index_m.html`, and `admin/assets/` from a React + Vite source tree under `src-admin/`. The build output SHALL be deterministic and SHALL be committed to the repository (so the Docker dev container does not need a Node toolchain at deploy time).

#### Scenario: build:admin produces the artefacts
- **WHEN** the developer runs `npm run build:admin` on a clean checkout
- **THEN** `admin/index.html` and `admin/index_m.html` are created
- **AND** `admin/assets/` contains at least one JS bundle and one CSS bundle

#### Scenario: build:admin is idempotent
- **WHEN** the developer runs `npm run build:admin` twice in a row without source changes
- **THEN** the second run produces a build that is byte-identical (or content-hash-identical) to the first

### Requirement: The form sources match between index.html and index_m.html
`admin/index.html` and `admin/index_m.html` SHALL render the same logical form. They MAY differ only in CSS class names, theme tokens, or layout container required by the materialize vs. non-materialize host shell. Both files SHALL load the same `jsonConfig.json5` schema.

#### Scenario: Both entry points render the same fields
- **WHEN** the user opens the wrench pop-up with materialize disabled
- **AND** then opens it with materialize enabled
- **THEN** both pop-ups show the same Connection, Status, and Devices panels
- **AND** both pop-ups accept and persist the same fields
