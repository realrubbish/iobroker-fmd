# Brand.md - ioBroker-fmd-adapter

## 1. Brand Overview

### 1.1 Project Identity

- **Adapter Name**: `ioBroker.fmd`
- **Project Name**: ioBroker-fmd-adapter
- **Type**: ioBroker Messaging Adapter
- **Purpose**: Ring FMD (Find My Device) devices via ioBroker

### 1.2 Parent Brands

This adapter is built within the ioBroker ecosystem and integrates with FMD:

| Brand | Relationship |
|-------|--------------|
| ioBroker | Platform, primary brand |
| FMD (Find My Device) | Integrated service |

## 2. Visual Identity

### 2.1 ioBroker Colors

The adapter follows ioBroker's official color scheme:

| Color | Hex | Usage |
|-------|-----|-------|
| **ioBroker Cyan** | `#39c` | Logo, active elements, highlights |
| **ioBroker Dark Blue** | `#164477` | Logo border, secondary elements |
| **Light Gray** | `#ccc` | Scrollbar track, splitters |
| **Medium Gray** | `#575757` | Scrollbar thumb |
| **Dark Gray** | `#333` | Hover states |
| **White** | `#fff` | Backgrounds, text |

### 2.2 Adapter Logo

- Use ioBroker logo with "fmd" text or icon
- Logo files location: `https://github.com/ioBroker/ioBroker/tree/master/img`
- Permission required: `info@iobroker.net`
- Adapter icon: `admin/fmd.png` (if custom)

### 2.3 Badge Colors (for README)

| Badge | Color Source |
|-------|--------------|
| NPM Version | ioBroker Cyan `#39c` |
| Downloads | ioBroker Dark Blue `#164477` |
| License | Gray `#333` |

## 3. Tone & Voice

### 3.1 Documentation Language

- **Primary Language**: English
- **Style**: Technical, precise, helpful
- **Audience**: Experienced ioBroker users

### 3.2 Writing Rules

| Rule | Example |
|------|---------|
| Use gender-neutral pronouns | "users", not "he/she" |
| Avoid personal pronouns in docs | "The adapter does X", not "I" or "you" |
| Use plural nouns | "users" not "a user" |
| Be specific | "ioBroker-fmd-adapter" not "the adapter" |
| Explain WHY | "Uses Argon2id because it's resistant to GPU attacks" |

### 3.3 Notes Format

```
*Note:* Important information goes here.

*Hinweis:* (German version if applicable)
```

### 3.4 Code Blocks

```javascript
// Always specify language for syntax highlighting
// Use full examples, not snippets
// Escape special characters: \_, \*, \\, \`
```

## 4. Naming Conventions

### 4.1 Adapter Naming

| Type | Convention | Example |
|------|------------|---------|
| NPM Package | `iobroker.fmd` | `npm install iobroker.fmd` |
| GitHub Repository | `ioBroker-fmd-adapter` | github.com/.../ioBroker-fmd-adapter |
| Adapter Instance | `fmd.0` | `sendTo('fmd.0', ...)` |
| Object Prefix | `fmd.0.` | `fmd.0.info.connection` |

### 4.2 State Naming

| State | ID | Type | Description |
|-------|-----|------|-------------|
| Connection | `fmd.0.info.connection` | boolean | FMD server reachable |
| Error | `fmd.0.info.error` | boolean | Error indicator |
| Last Error | `fmd.0.info.lastError` | string | Error message |
| Ring Command | `0_userdata.0.FindMyDevice.ring` | string | Ring trigger |
| Devices | `fmd.0.devices` | object | Device list |

## 5. README Structure

### 5.1 Standard Sections

```
1. Badges (top) - version, downloads, tests, license
2. Logo + Title - ioBroker.fmd with icon
3. Overview - One paragraph description
4. Features - Bullet list of capabilities
5. Requirements - Node.js, js-controller, admin versions
6. Installation - npm install command
7. Configuration - Setup instructions
8. Usage - Code examples (hardware + software button)
9. Changelog - Version history (or link to CHANGELOG.md)
10. License - MIT with copyright
11. Links - FMD Server, Documentation, etc.
```

### 5.2 vis-2 Dashboard Integration

When documenting vis-2 integration:

```json
{
  "oid": "0_userdata.0.FindMyDevice.ring",
  "value": "my-phone"
}
```

Or via JavaScript:
```javascript
setState('0_userdata.0.FindMyDevice.ring', 'my-phone');
```

## 6. Target Audience Profile

### 6.1 User Demographics

- **Technical Level**: Medium to High
- **Experience**: Familiar with ioBroker administration
- **Environment**: Self-hosted ioBroker installation
- **Use Case**: Home automation with physical/virtual buttons

### 6.2 User Needs

| Need | Solution |
|------|----------|
| Quick phone finding | One-button ring |
| Dashboard integration | vis-2 software button |
| Automation scripts | `sendTo('fmd.0', 'ring', ...)` |
| Secure credentials | encryptedNative storage |

## 7. Competitive Positioning

### 7.1 Similar Adapters

| Adapter | Difference |
|---------|------------|
| ioBroker.telegram | Sends messages, not device commands |
| ioBroker.pushover | Generic notifications |
| ioBroker.fmd | **FMD-specific** ring/lock/locate/wipe |

### 7.2 Unique Value

- Direct FMD integration (not generic notification)
- Hardware button trigger support
- Secure credential storage
- Device-specific ring commands

## 8. Brand Assets

### 8.1 Required Files

| File | Location | Description |
|------|---------|-------------|
| Logo | `admin/` or `media/` | Adapter icon |
| README.md | Root | Main documentation |
| LICENSE | Root | MIT License |

### 8.2 Copyright

```
MIT License

Copyright 2024-2026 ioBroker-fmd-adapter contributors
```

Include in all published documentation.

## 9. References

- [ioBroker Branding](https://github.com/ioBroker/ioBroker/tree/master/img)
- [ioBroker Style Guide](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/community/styleguidedoc.md)
- [FMD Official](https://fmd-foss.org/)
