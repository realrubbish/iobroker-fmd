# Research: ioBroker-fmd-adapter

> Sammelmappe aller Research-Ergebnisse für die Dokumentation des ioBroker-fmd-adapters.

**Erstellt:** 2026-06-05
**Basierend auf:** `docs/vision.md`

---

## Research-Status

| Section | Status | Agent |
|---------|--------|-------|
| [Product.md](#1-productmd) | ✅ Fertig | ab49aa7d |
| [Architecture.md](#2-architecturmd) | ✅ Fertig | add71b7c |
| [Mode-Of-Work.md](#3-mode-of-workmd) | ✅ Fertig | ac0ce405 |
| [Brand.md](#4-brandmd) | ✅ Fertig | a7f13aa9 |
| [Visual.md](#5-visualmd) | ✅ Fertig | manuell nachgeholt |
| [User-Experience.md](#6-user-experiencemd) | ✅ Fertig | aa58448d |
| [Guidelines/JavaScript.md](#7-guidelinesjavascriptmd) | ✅ Fertig | a71577bc |
| [README.md](#8-readmemd) | ✅ Fertig | ab234f15 |

---

## 1. Product.md

### 1.1 Was ist ein ioBroker-Adapter?

Ein ioBroker-Adapter ist ein Software-Modul, das die ioBroker-Smart-Home-Plattform erweitert. ioBroker selbst ist eine Automatisierungsplattform ("automate your life - platform", Version 4.0.3), die verschiedene Smart-Home-Geräte und -Dienste integriert.

**Kernkomponenten:**
- **js-controller** (iobroker.js-controller@7.1.2): Das Herzstück, das alle Adapter verwaltet
- **@iobroker/adapter-core@3.3.2**: Bridge-Modul zwischen Adapter und js-controller
- **@iobroker/create-adapter@3.1.5**: CLI-Tool zur Adapter-Generierung

### 1.2 FMD (Find My Device) - API für Ring-Befehle

| Methode | Beschreibung |
|---------|-------------|
| `device.play_sound()` | Lässt das Gerät klingeln (Ring-Befehl) |
| `device.lock(message=None)` | Sperrt das Gerät mit optionaler Nachricht |
| `device.wipe(pin, confirm=True)` | Remote-Wipe (benötigt FMD-PIN) |

### 1.3 FMD-Authentifizierung

```
1. salt (vom Server)
   ↓
2. Argon2id (Passwort-Hashing mit Salt)
   ↓
3. access_token (nach erfolgreichem Hash)
   ↓
4. private_key (Abruf und Entschlüsselung)
```

**Sicherheitsmerkmale:**
- **Algorithmus**: Argon2id für Passwort-Hashing
- **Verschlüsselung**: RSA-3072 OAEP (SHA-256) mit AES-GCM
- **Session-Key**: AES-GCM mit 12-Byte-IV

### 1.4 ntfy in diesem Kontext

**Architektur des Gesamtsystems:**

```
[Shelly 1PM mini Button]
    ↓ (MQTT: triple_push)
[shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event]
    ↓
[ioBroker auf zephyr.schnurri.ch]
    ↓ (JavaScript/Adapter)
[FMD-Server auf fmd.schnurri.ch:443]
    ↓ (ntfy push)
[Handy mit FMD/ntfy-App]
    → Klingelton!
```

### 1.5 Technischer Stack dieses Projekts

| Komponente | Version | Beschreibung |
|------------|---------|--------------|
| ioBroker js-controller | 7.1.2 | Plattform |
| @iobroker/adapter-core | 3.3.2 | Adapter-Framework |
| @iobroker/create-adapter | 3.1.5 | Adapter-Generator |
| FMD-Server | 0.14.0 | Docker-Container |
| ntfy | 1.15.3 (npm) | Push-Benachrichtigungen |
| axios | 1.17.0 | HTTP-Client |

---

## 2. Architecture.md

### 2.1 ioBroker-Adapter-Architektur

**Verzeichnisstruktur:**

```
iobroker.fmd/
├── admin/                 # Admin-UI Dateien
├── lib/                   # Bibliothekscode
├── src/                   # TypeScript-Quellcode
├── test/                  # Testdateien
├── widgets/               # VIS-Widget-Dateien
├── main.js               # Hauptadapter-Datei
├── io-package.json       # Adapter-Konfiguration und Metadaten
├── package.json          # npm-Paketdatei
├── README.md             # Adapter-Dokumentation
└── LICENSE               # Lizenzdatei
```

### 2.2 main.js - Lebenszyklus-Methoden

```javascript
class FmdAdapter extends utils.Adapter {
    onReady() { }           // Adapter initialisiert
    onUnload(callback) { }  // Adapter wird gestoppt
    onStateChange(id, state) { }  // Zustandsänderung
}
```

### 2.3 Adapter-Modi

| Modus | Beschreibung |
|-------|--------------|
| `daemon` | Läuft kontinuierlich |
| `schedule` | CRON-basiert |
| `once` | Einmalige Ausführung |
| `none` | Kein unabhängiger Prozess |

### 2.4 Button-Trigger-Flow (Hardware)

```
Shelly Button (triple_push)
    ↓ MQTT
MQTT Broker (shelly.0)
    ↓ stateChange
ioBroker State DB
    ↓ subscription
JavaScript Script
    ↓ sendTo
FMD Adapter (fmd.0)
    ↓ POST /api/v1/command
FMD Server (https://fmd.schnurri.ch)
    ↓ ntfy push
FMD App auf Handy
    ↓
Handy klingelt
```

### 2.5 FMD-Server API

**Authentifizierungs-Header bei API-Requests:**
```json
{
  "IDT": "<access_token>",
  "Data": "<command>",
  "UnixTime": <unix_timestamp_ms>,
  "CmdSig": "<base64_rsa_signature>"
}
```

**Unterstützte Commands:**
- `ring` / `play_sound` - Handy klingeln lassen
- `lock` - Gerät sperren
- `locate` - GPS-Standort abrufen
- `wipe` - Gerät löschen

---

## 3. Mode-Of-Work.md

### 3.1 Conventional Commits

**Format:**
```
<type>[<optional scope>][<optional !>]: <description>

[optional body]

[optional footer(s)]
```

**Commit-Typen:**

| Type | Description |
|------|-------------|
| `feat` | New feature for the user |
| `fix` | Bug fix for the user |
| `docs` | Documentation only changes |
| `style` | Formatting, semicolons (no semantic change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Code change that improves performance |
| `test` | Adding or correcting tests |
| `chore` | Build process or auxiliary tools |
| `build` | Build system or dependencies |
| `ci` | CI configuration files and scripts |
| `revert` | Reverts a previous commit |

**Beispiele:**
```
feat: add ring command support for FMD devices
fix(auth): resolve token expiration handling
docs(readme): clarify installation steps
```

### 3.2 Git Best Practices

**Branch-Workflow:**
- Topic Branches für einzelne Features/Bugfixes
- Nie direkt auf master/main pushen
- PR-basiert arbeiten
- Nach dem Mergen löschen

**Regeln:**
- ❌ **NO** `git commit --amend`
- ❌ **NO** destructive operations (force push, etc.)
- ❌ **NO** auto-commit - nur auf User-Anweisung
- ✅ Kleine, logische Chunks
- ✅ Klare Commit-Messages mit Erklärung

### 3.3 Chunk-basiertes Arbeiten

| Benefit | Description |
|---------|-------------|
| Lightweight | Günstig zu erstellen/loeschen in Git |
| Context Switching | Schneller Wechsel ohne Kontamination |
| Code Review | Einfacher zu reviewen |
| Flexibility | Minuten, Tage oder Monate existieren |

**Typischer Workflow:**
```bash
git checkout -b feature/ring-command
# Work...
git commit -m "feat: add ring command to FMD adapter"
git checkout main
git merge feature/ring-command
```

### 3.4 Projekt-spezifische Regeln

| Regel | Quelle |
|-------|--------|
| **Nie automatisch committen und pushen** | vision.md |
| **Oeffentliches Repository** - immer Kommentare und Docs | vision.md |
| **Immer Conventional Commits verwenden** | this research |

---

## 4. Brand.md

### 4.1 ioBroker Branding

**Logo:**
- Alle ioBroker Logos sind urheberrechtlich geschützt
- Genehmigung via `info@iobroker.net`
- Offizielle Logos: `ioBroker_logo_b.png`, `ioBroker_logo_s.png`
- Adapter-Name: `ioBroker.fmd`

**Style Guide:**
- Gender-neutral pronouns ("they", "their")
- Keine persönlichen Pronomen ("I", "you", "we") in Referenz-Dokumentation
- 80-Zeichen Zeilenumbruch
- File/Folder names: lowercase only

**Notes Formatting:**
- `*Note*:` oder `*Hinweis*:` in italic
- Grossbuchstabe nach dem Doppelpunkt

### 4.2 FMD Branding

**Projekt-Identität:**
- Name: FMD (Find My Device) - fmd-foss
- Website: `https://fmd-foss.org/`
- GitLab: `https://gitlab.com/fmd-foss`

**Wichtig:** FMD hat **keine veröffentlichten Branding-Richtlinien**. Keine Logo-Dateien, Farbschemata oder Typography-Spezifikationen dokumentiert.

### 4.3 README-Struktur (typisch)

1. Logo + title header
2. Badge row (version, downloads, tests, license)
3. Brief description paragraph
4. Feature list or capabilities
5. Installation/configuration instructions
6. Special notes or requirements
7. Migration guide (if applicable)
8. Changelog (reverse chronological)
9. License section
10. About/topics footer

### 4.4 Zielgruppe: ioBroker-Nutzer

**Profil:**
- Smart home / home automation enthusiasts
- Technical comfort level: medium to high
- Self-hosting capability
- Multi-language community
- Familiar with JavaScript/TypeScript

---

## 5. Visual.md

### 5.1 ioBroker Farbpalette (verifiziert via iobroker.net CSS)

**Primärfarben:**
| Name | Hex | Verwendung |
|------|-----|------------|
| ioBroker Cyan | `#39c` | Logo, aktive Elemente, Highlights |
| ioBroker Dunkelblau | `#164477` | Logo-Border, sekundäre Elemente |

**Neutralfarben:**
| Name | Hex | Verwendung |
|------|-----|------------|
| Hellgrau | `#ccc` | Scrollbar-Track, Splitter |
| Mittelgrau | `#575757` | Scrollbar-Thumb |
| Dunkelgrau | `#333` | Hover-States |
| Weiß | `#fff` | Hintergründe, Text |
| Schwarz | `#000` | Logo-Hintergrund |

**Semantische Farben:**
| Name | Hex | Verwendung |
|------|-----|------------|
| Neon-Grün | `#a2ff00` | Animation, Akzente |
| Cyan | `#0af` | Animation, Links |

### 5.2 ioBroker Design-System

**Breakpoints:**
| Breakpoint | Viewport |
|------------|----------|
| xs | < 600px (Mobile) |
| sm | 600-900px (Tablet Portrait) |
| md | 900-1200px (Tablet Landscape) |
| lg | 1200-1536px (Desktop) |
| xl | > 1536px (Große Screens) |

**Grid:** 12-Spalten-System

**Typography:**
- Font-Family: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif`
- Font-Dosis für Headlines
- Font-Cutive Mono für Code

### 5.3 Admin UI

- JSON Config (`admin/jsonConfig.json5`)
- Typ: `tabs`, `panel`, `text`, `checkbox`, `select`, `slider`, `table`, etc.
- i18n-Support via `admin/i18n/<lang>/translations.json`

---

## 6. User-Experience.md

### 6.1 Log-Level

5 Stufen (von least zu most verbose):
- `error` - Nur Fehler
- `warn` - Warnungen
- `info` - Standard
- `debug` - Detaillierte Informationen
- `silly` - Maximale Verbosity

### 6.2 Error-States

**Quality-Codes (q):**
| Quality | Bedeutung |
|---------|-----------|
| 0 | Gut (kein Fehler) |
| 0x01 | general problem |
| 0x02 | no connection |
| 0x04 | device error |
| 0x08 | sensor error |

**Indikator-Rollen:**
- `indicator.error` - Fehlerzustand
- `indicator.reachable` - Erreichbarkeit
- `indicator.maintenance` - Wartungsbedarf

### 6.3 Notifications

```javascript
adapter.registerNotification(
    'FMD',                          // Scope
    'connectionError',               // Category
    'Cannot connect to FMD server'   // Message
);
```

### 6.4 Logging-Muster

```javascript
adapter.log.error('FMD connection failed: ' + err.message);
adapter.log.warn('FMD response timeout, retrying...');
adapter.log.info('FMD ring command sent successfully');
adapter.log.debug('MQTT message received: ' + JSON.stringify(msg));
```

### 6.5 Admin UI Config (jsonConfig.json5)

**Beispiel-Struktur:**
```json
{
    "type": "tabs",
    "i18n": true,
    "items": {
        "connection": {
            "type": "panel",
            "label": "FMD Connection",
            "items": {
                "serverUrl": { "type": "text", "label": "FMD Server URL" },
                "username": { "type": "text", "label": "Username" },
                "password": { "type": "password", "label": "Password" }
            }
        }
    }
}
```

---

## 7. Guidelines/JavaScript.md

### 7.1 TypeScript vs JavaScript

- **TypeScript** ist die empfohlene Sprache für neue ioBroker-Adapter
- Beide unterstützen ESLint für Code-Qualität
- TypeScript bietet Strongly-typed `adapter.config`

### 7.2 Main Adapter Class Pattern

```typescript
import * as utils from "@iobroker/adapter-core";

class MyAdapter extends utils.Adapter {
    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: "fmd" });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }
}
```

### 7.3 Lifecycle Methods

- **`onReady`**: Async initialization - `this.config` für Config
- **`onUnload`**: Cleanup - Timer/Intervals löschen
- **`onStateChange`**: `(id, state)` mit `state.val` und `state.ack`

### 7.4 ESLint/Prettier

**Base:** `@iobroker/eslint-config`

**Ignorierte Files:**
- `admin/words.js`
- `admin/admin.d.ts`
- `build/`, `dist/`
- `*.test.js`

### 7.5 Testing Framework

| Component | Library |
|-----------|---------|
| Test Runner | **mocha** |
| Assertions | **chai** |
| Spies/Stubs/Mocks | **sinon** |
| Coverage | **nyc** |
| Testing Utils | **@iobroker/testing** |

### 7.6 Projekt-Struktur Requirements

**Required Files:**
- `io-package.json`
- `package.json`
- `tsconfig.json`
- `eslint.config.mjs`
- `LICENSE`
- `README.md`

**DevDependencies:**
- `@iobroker/adapter-core`
- `@iobroker/testing`
- `@iobroker/adapter-dev`
- `@iobroker/eslint-config`
- `typescript@~5.9`
- `eslint@^9`

---

## 8. README.md

### 8.1 Badge-Struktur

```markdown
[![NPM Version](https://img.shields.io/npm/v/iobroker.fmd?style=flat-square)](https://www.npmjs.com/package/iobroker.fmd)
[![Downloads](https://img.shields.io/npm/dm/iobroker.fmd?style=flat-square)](https://www.npmjs.com/package/iobroker.fmd)
[![Test and Release](https://github.com/username/ioBroker-fmd-adapter/workflows/Test%20and%20Release/badge.svg)](https://github.com/username/ioBroker-fmd-adapter)
[![License](https://img.shields.io/github/license/username/ioBroker-fmd-adapter?style=flat-square)](LICENSE)
```

### 8.2 Empfohlene README-Sections

1. Badges (top)
2. Overview (one-paragraph description)
3. Features (bullet list)
4. Requirements (Node.js, js-controller, admin)
5. Installation (`npm install iobroker.fmd`)
6. Configuration
7. Usage (with code examples)
8. Changelog (or link to CHANGELOG.md)
9. License

### 8.3 Hardware Button Integration

```javascript
on({id: 'shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event', change: 'triple_push'}, function() {
    sendTo('fmd.0', 'ring', { device: 'my-phone' });
});
```

### 8.4 vis-2 Software Button

```json
{
  "oid": "0_userdata.0.FindMyDevice.ring",
  "value": "my-phone"
}
```

---

## Quellen

- [ioBroker/create-adapter](https://github.com/ioBroker/create-adapter)
- [ioBroker/js-controller](https://github.com/ioBroker/ioBroker.js-controller)
- [ioBroker MQTT Adapter](https://github.com/iobroker/iobroker.mqtt)
- [ioBroker JavaScript Adapter](https://github.com/ioBroker/ioBroker.javascript)
- [FMD Server](https://gitlab.com/fmd-foss/fmd-server)
- [FMD Documentation](https://fmd-foss.org/docs/fmd-server)
- [FMD API Python Client](https://github.com/devinslick/fmd_api)
- [ntfy Documentation](https://ntfy.sh/docs/)
- [ioBroker Documentation Style Guide](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/community/styleguidedoc.md)
- [ioBroker.shelly Adapter](https://github.com/iobroker-community-adapters/iobroker.shelly)
- [ioBroker.telegram Adapter](https://github.com/iobroker-community-adapters/iobroker.telegram)
- [Pro Git Book](https://git-scm.com/book/en/v2)
- [Conventional Commits](https://www.conventionalcommits.org)
