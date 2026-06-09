# CLAUDE.md - ioBroker-fmd-adapter

## Project Overview

- **Name**: ioBroker-fmd-adapter
- **Purpose**: Ring FMD (Find My Device) devices via ioBroker hardware buttons (Shelly) or vis-2 software buttons
- **Tech Stack**: TypeScript, ioBroker Adapter Framework, FMD Server API
- **Repository**: Public GitHub repository

## Key References

- **Vision**: `docs/vision.md` - Project vision and requirements
- **Research**: `docs/Research.md` - Collected research data
- **FMD Server**: https://fmd.example.com (user's deployment)
- **FMD Docs**: https://fmd-foss.org/docs/fmd-server
- **ioBroker Adapter Template**: https://github.com/ioBroker/create-adapter

## Important Rules

### Git & Commit Rules
- ❌ **NEVER** auto-commit or auto-push - only when user explicitly tells you to
- ❌ **NO** `git commit --amend`
- ❌ **NO** destructive git operations (force push, etc.)
- ✅ Use **Conventional Commits** format: `type(scope): description`
- ✅ Commit types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`
- ✅ Split work into small logical chunks
- ✅ Always explain WHY in commit messages for public repository

### Workflow
1. Work in small chunks (one logical change per chunk)
2. Stop after each chunk for manual user review
3. Never assume - always verify
4. Check up-to-date documentation
5. Clarify unclear things - build common understanding
6. Present summary after each chunk

### OpenSpec Workflow

Dieses Projekt nutzt OpenSpec für strukturierte Changes.

**Befehle:**
- `/opsx:propose <name>` - Neue Change vorschlagen (erstellt proposal, design, specs, tasks)
- `/opsx:apply` - Tasks implementieren
- `/opsx:archive` - Change archivieren wenn fertig

**Change Struktur:**
```
openspec/changes/<name>/
├── proposal.md      # Was & Warum
├── design.md        # Technische Entscheidungen
├── specs/           # Detaillierte Requirements
│   └── <capability>/spec.md
└── tasks.md         # Implementierungs-Tasks
```

**Regeln:**
- ❌ KEINE Features implementieren die nicht in einer genehmigten Change sind
- ❌ NICHT nach "/opsx:apply" fragen "was als nächstes?"
- ✅ Nach apply: Tasks als done markieren, dann `/opsx:archive` anbieten

### Architecture Context
```
[Shelly Button] → MQTT → [ioBroker] → [FMD Adapter] → [FMD Server] → [ntfy] → [Phone]
```

### Button Object
- ID: `shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event`
- Trigger: `triple_push`

### FMD Authentication
- Multi-step: Salt → Argon2id → Access Token → Private Key
- Credentials stored via `encryptedNative` in io-package.json

## Branding

- **Adapter Name**: `ioBroker.fmd`
- **Style**: ioBroker official style (cyan `#39c`, dark blue `#164477`)
- **Documentation Language**: English
- **Target Audience**: Experienced ioBroker users

## Deployment & Testing Workflow

**For every change — always follow this exact sequence:**

0. **Smoke test the auth/ring path from the dev host (recommended)**
   Before going through the full Docker rebuild, verify the auth and
   ring code paths against a real FMD server from your dev host:
   ```bash
   FMD_SERVER_URL=https://fmd.example.com \
   FMD_USERNAME=<user> FMD_PASSWORD=<pw> \
     npm run auth:smoke
   # and for ring changes:
   FMD_SERVER_URL=https://fmd.example.com \
   FMD_USERNAME=<user> FMD_PASSWORD=<pw> FMD_DEVICE_ID=<id> \
     npm run ring:smoke
   ```
   Both scripts read credentials from `process.env`, exit 0 on
   success, and print a short status line. The ring smoke script
   confirms "the server accepted the request" only — the device app
   is the only ground truth for "the phone will ring". Requires
   `npm run build:tsc` to have produced `build/lib/`.

   For ring-signing changes specifically, run the offline
   sign-then-verify round-trip first — no credentials, no
   network, no FMD server required:
   ```bash
   npm run ring:smoke:verify
   ```
   It generates a throwaway 2048-bit RSA key pair, signs a
   fixed payload with the same `signRingPayload` code path the
   adapter uses, and verifies it locally with the same PSS
   profile. Exit 0 on a clean round-trip; exit 1 on a PSS
   parameter desync (the kind of thing that breaks "the phone
   rings" silently). Run this *before* `npm run ring:smoke` so
   a broken signature shape is caught without burning a live
   round-trip on the FMD server.

1. **Commit & Push**
   ```bash
   git add <files>
   git commit -m "fix: describe your change"
   git push
   ```

2. **Build the Admin UI** (mandatory when `src-admin/`, `admin/jsonConfig.json5`, or `admin/index*.html` changed)
   ```bash
   npm run build:admin
   ```
   This runs `scripts/build-admin.mjs`, which:
   - Wipes the build outputs in `admin/` (`index.html`, `index_m.html`, `assets/`)
   - Invokes Vite to regenerate them from `src-admin/`
   - Copies the source-of-truth schema `src-admin/schema.json5` to `admin/jsonConfig.json5`
   - Leaves `admin/settings.json` and `admin/favicon.ico` untouched (they are hand-managed)
   - Commit the regenerated `admin/` artefacts together with the `src-admin/` source change. The artefacts are required because the Docker dev container does not run a Node toolchain at deploy time.

3. **Start/Restart Docker Container**
   ```bash
   docker compose up -d
   # or: docker compose restart
   ```

4. **Install Adapter from GitHub**
   ```bash
   docker exec iobroker-fmd-dev iobroker url https://github.com/realrubbish/iobroker-fmd
   ```

5. **Fix Adapter Directory (Workaround)**
   ```bash
   docker exec iobroker-fmd-dev bash -c "\
     mkdir -p /opt/iobroker/node_modules/iobroker.iobroker-fmd && \
     cp -r /opt/iobroker/node_modules/iobroker.fmd/* /opt/iobroker/node_modules/iobroker.iobroker-fmd/ && \
     chown -R iobroker:iobroker /opt/iobroker/node_modules/iobroker.iobroker-fmd"
   ```

6. **Upload & Register Adapter**
   ```bash
   docker exec iobroker-fmd-dev iobroker upload iobroker-fmd
   ```

7. **Force io-package.json Refresh** (mandatory when `io-package.json` changed, especially `adminUI` flags)
   ```bash
   docker exec iobroker-fmd-dev touch /opt/iobroker/iobroker-data/files/iobroker-fmd/io-package.json
   ```
   `iobroker upload` does NOT refresh the controller's cached copy of `io-package.json` on its own. Touching the file forces the controller to re-read it on the next access, which is what makes new `adminUI` flags (or any schema change) actually take effect. Skip this step only if step 6 was the only `io-package.json`-touching change.

8. **Add Instance** (only on first install or after adapter-name change)
   ```bash
   docker exec iobroker-fmd-dev iobroker add iobroker-fmd
   ```

9. **Verify**
   ```bash
   docker exec iobroker-fmd-dev iobroker logs iobroker-fmd --files=20
   ```
   Then in the browser: hard-reload ioBroker.admin (Cmd/Ctrl+Shift+R), click the wrench on the `iobroker-fmd.0` instance row. The wrench pop-up must load the new `admin/index.html` form, not a 404.

**Note on Directory Workaround:** Due to a known ioBroker issue with third-party GitHub adapters, npm installs as `iobroker.fmd` but ioBroker expects `iobroker.iobroker-fmd`. This workaround creates the correct directory structure.

**Note on adminUI 404 (the symptom of this change):** ioBroker.admin 7.7.22 (the new React SPA) always loads the wrench pop-up as an iframe pointing at `admin/index.html` (or `admin/index_m.html` for materialize users). If those files are missing, the browser console logs `GET /adapter/iobroker-fmd/index.html?... 404` and the pop-up is empty. The `adminUI.config = "json"` flag does **not** skip the iframe; it only changes the data source for the Instances list and the sidebar adapter tab. See `docs/admin-ui.md` for the full architecture and `docs/admin-ui-investigation-2026-06-08.md` for the diagnostic that led to this change.

**Future (v1.0.0):** Once published to npm, only steps 1-4, 6, 8-9 will be needed (the directory workaround and the io-package.json touch become unnecessary).
