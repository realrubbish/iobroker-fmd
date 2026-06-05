# CLAUDE.md - ioBroker-fmd-adapter

## Project Overview

- **Name**: ioBroker-fmd-adapter
- **Purpose**: Ring FMD (Find My Device) devices via ioBroker hardware buttons (Shelly) or vis-2 software buttons
- **Tech Stack**: TypeScript, ioBroker Adapter Framework, FMD Server API
- **Repository**: Public GitHub repository

## Key References

- **Vision**: `docs/vision.md` - Project vision and requirements
- **Research**: `docs/Research.md` - Collected research data
- **FMD Server**: https://fmd.schnurri.ch (user's deployment)
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
