# Product.md - ioBroker-fmd-adapter

## 1. Product Overview

**Project Name:** ioBroker-fmd-adapter
**Type:** ioBroker Messaging Adapter
**Core Functionality:** Ring FMD (Find My Device) devices via ioBroker by triggering hardware buttons (Shelly) or software buttons (vis-2 Dashboard)

## 2. Business View

### 2.1 Purpose

This adapter bridges ioBroker with the FMD service, enabling users to locate their devices (phone, tablet) by triggering a ring command through physical buttons or software interfaces.

### 2.2 Target Users

- Experienced ioBroker users with home automation setup
- Users who already run an FMD server
- Users with Shelly devices (e.g., Shelly 1PM mini) for physical triggers
- Users wanting vis-2 Dashboard integration

### 2.3 Problem Statement

Currently, finding a lost phone requires opening the FMD app or website. This adapter enables:
- One-button press (Shelly hardware button) to ring the phone
- Software button on vis-2 Dashboard for quick access
- Integration with existing ioBroker automation scripts

### 2.4 Success Metrics

- Reliable ring command delivery to FMD server
- Secure credential storage
- Support for multiple FMD devices
- Clean error handling and user feedback

## 3. Technical Context

### 3.1 System Architecture

```
[Shelly 1PM mini Button]
    ↓ (MQTT: triple_push)
[shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event]
    ↓
[ioBroker on zephyr.example.com]
    ↓ (JavaScript/Adapter)
[FMD Server on fmd.example.com:443]
    ↓ (ntfy push)
[Phone with FMD/ntfy App]
    → Ringtone plays!
```

### 3.2 Core Components

| Component | Version | Description |
|-----------|---------|-------------|
| ioBroker js-controller | 7.1.2 | Core platform |
| @iobroker/adapter-core | 3.3.2 | Adapter framework |
| @iobroker/create-adapter | 3.1.5 | Adapter generator |
| FMD Server | 0.14.0+ | Docker container |
| ntfy | 1.15.3 | Push notifications |

### 3.3 FMD API

**Authentication Flow:**
```
1. Salt Request → Server with FMD ID
2. Argon2id Hashing → Password + Salt → secure hash
3. Access Token → Exchange hash for time-limited token (IDT)
4. Private Key → Retrieve encrypted RSA private key blob
5. Key Decryption → Secondary Argon2id derivation with Password
```

**Supported Commands:**
| Command | Description |
|---------|-------------|
| `ring` / `play_sound` | Ring the device |
| `lock` | Lock the device with optional message |
| `locate` | Get GPS location |
| `wipe` | Remote wipe (requires FMD PIN) |

## 4. Configuration

### 4.1 Required Settings

| Parameter | Type | Description |
|-----------|------|-------------|
| `fmdServerUrl` | string | FMD Server URL (e.g., `https://fmd.example.com`) |
| `username` | string | FMD username |
| `password` | string | FMD password (stored encrypted) |

### 4.2 Security

- Password stored via `encryptedNative` in `io-package.json`
- Automatic encryption/decryption by ioBroker Admin
- Protected access via `protectedNative`

## 5. Features

### 5.1 Core Features

- [ ] FMD server connection with secure authentication
- [ ] Ring command (`play_sound`) to trigger device
- [ ] Support for multiple FMD devices
- [ ] Hardware button trigger via MQTT subscription
- [ ] Software button support via vis-2 Dashboard
- [ ] Error state indicators (`indicator.error`, `indicator.reachable`)
- [ ] Configurable log level

### 5.2 Future Considerations

- Lock command support
- Locate command support
- Multiple button trigger types (single, double, triple push)
- Device selection in UI

## 6. Dependencies

### 6.1 Runtime

- `@iobroker/adapter-core` - Adapter framework
- `axios` - HTTP client for FMD API

### 6.2 Development

- `@iobroker/testing` - Test utilities
- `@iobroker/adapter-dev` - Development tools
- `@iobroker/eslint-config` - Code quality
- `typescript@~5.9` - TypeScript support
- `eslint@^9` - Linting

## 7. References

- [FMD Server](https://gitlab.com/fmd-foss/fmd-server)
- [FMD Documentation](https://fmd-foss.org/docs/fmd-server)
- [FMD Python Client](https://github.com/devinslick/fmd_api) - Reference implementation
- [ioBroker create-adapter](https://github.com/ioBroker/create-adapter)
- [ioBroker Adapter Development](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterdev.md)
