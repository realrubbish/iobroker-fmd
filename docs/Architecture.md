# Architecture.md - ioBroker-fmd-adapter

## 1. Architecture Overview

This document describes the technical architecture of the ioBroker-fmd-adapter.

## 2. Adapter Structure

### 2.1 Directory Structure

```
iobroker.fmd/
├── admin/                      # Admin UI files
│   ├── jsonConfig.json5        # JSON configuration schema
│   └── i18n/                   # Internationalization
│       ├── de/translations.json
│       └── en/translations.json
├── lib/                        # Library code
├── src/                        # TypeScript source code
│   ├── main.ts                 # Main adapter class
│   └── tools.ts                # Utility functions
├── test/                       # Test files
│   ├── unit/                   # Unit tests
│   ├── integration/            # Integration tests
│   └── mocha.setup.js          # Mocha configuration
├── widgets/                    # VIS widget files (if needed)
├── io-package.json             # ioBroker package definition
├── package.json                # npm package definition
├── tsconfig.json               # TypeScript configuration
├── eslint.config.mjs           # ESLint configuration
└── README.md                   # Documentation
```

### 2.2 Main Adapter Class

```typescript
import * as utils from "@iobroker/adapter-core";

class FmdAdapter extends utils.Adapter {
    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: "fmd" });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> { }
    private onUnload(callback: () => void): void { }
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void { }
}
```

## 3. Lifecycle Methods

### 3.1 onReady()

Called when the adapter is initialized. Use for:
- Reading configuration via `this.config`
- Creating states/objects
- Establishing connections
- Setting up subscriptions

### 3.2 onUnload(callback)

Called when the adapter is stopped. Must:
- Clear timers and intervals
- Close connections
- Call `callback()` when cleanup is complete

### 3.3 onStateChange(id, state)

Called when subscribed states change. Parameters:
- `id`: Full state ID
- `state`: State object with `val`, `ack`, `ts`, `q`, etc.

## 4. Data Flow

### 4.1 Hardware Button Trigger Flow

```
[Shelly Button] → MQTT Broker → shelly.0 adapter → ioBroker State DB
                                                            ↓
                                                     State Subscription
                                                            ↓
                                                     onStateChange()
                                                            ↓
                                                     FMD API Call
                                                            ↓
                                                     FMD Server
                                                            ↓
                                                     ntfy Push
                                                            ↓
                                                     Phone Rings!
```

### 4.2 Software Button Flow

```
[vis-2 Widget Button] → setState() → ioBroker State DB
                                               ↓
                                         sendTo('fmd.0', 'ring', ...)
                                               ↓
                                         onMessage('ring', ...)
                                               ↓
                                         FMD API Call → Phone Rings!
```

## 5. FMD API Integration

### 5.1 Authentication

The adapter must implement the multi-step FMD authentication:

```typescript
interface FmdAuth {
    salt: string;
    accessToken: string;
    privateKey: string;
}

async function authenticate(
    serverUrl: string,
    username: string,
    password: string
): Promise<FmdAuth> {
    // 1. Request salt from server
    // 2. Derive key using Argon2id
    // 3. Exchange for access token
    // 4. Retrieve and decrypt private key
}
```

### 5.2 API Request Signing

FMD requires RSA-PSS signed requests:

```typescript
interface FmdRequest {
    IDT: string;           // Access token
    Data: string;          // Command
    UnixTime: number;      // Unix timestamp in ms
    CmdSig: string;        // Base64 RSA signature
}
```

### 5.3 Ring Command

```typescript
async function sendRingCommand(
    auth: FmdAuth,
    serverUrl: string,
    deviceId: string
): Promise<void> {
    const command = `ring:${deviceId}`;
    const signature = await signRequest(command, auth.privateKey);

    await axios.post(`${serverUrl}/api/v1/command`, {
        Data: command,
        UnixTime: Date.now(),
        CmdSig: signature
    }, {
        headers: { 'IDT': auth.accessToken }
    });
}
```

## 6. Configuration Schema

### 6.1 io-package.json (common section)

```json
{
  "common": {
    "name": "fmd",
    "title": "FMD (Find My Device)",
    "titleLang": {
      "en": "FMD (Find My Device)",
      "de": "FMD (Find My Device)"
    },
    "desc": {
      "en": "Ring FMD devices via ioBroker",
      "de": "FMD Geräte über ioBroker klingeln lassen"
    },
    "type": "messaging",
    "connectionType": "cloud",
    "dataSource": "push",
    "encryptedNative": ["password"],
    "protectedNative": ["password"],
    "adminUI": {
      "config": "json"
    }
  },
  "native": {
    "serverUrl": "https://fmd.schnurri.ch",
    "username": "",
    "password": ""
  }
}
```

### 6.2 Admin UI (jsonConfig.json5)

```json
{
    "type": "tabs",
    "i18n": true,
    "items": {
        "connection": {
            "type": "panel",
            "label": "FMD Connection",
            "items": {
                "serverUrl": {
                    "type": "text",
                    "label": "FMD Server URL",
                    "default": "https://fmd.schnurri.ch"
                },
                "username": {
                    "type": "text",
                    "label": "Username"
                },
                "password": {
                    "type": "password",
                    "label": "Password"
                }
            }
        },
        "notifications": {
            "type": "panel",
            "label": "Notifications",
            "items": {
                "notifyOnError": {
                    "type": "checkbox",
                    "label": "Send notification on errors",
                    "default": true
                }
            }
        }
    }
}
```

## 7. State Objects

### 7.1 Adapter States

| State ID | Type | Role | Description |
|----------|------|------|-------------|
| `fmd.0.info.connection` | boolean | `indicator.reachable` | FMD server reachable |
| `fmd.0.info.error` | boolean | `indicator.error` | Connection error |
| `fmd.0.info.lastError` | string | `text` | Last error message |
| `0_userdata.0.FindMyDevice.ring` | string | `command` | Ring command trigger |
| `fmd.0.devices` | object | `meta` | List of FMD devices |

## 8. Error Handling

### 8.1 Quality Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | Good | No error |
| 0x01 | General Problem | Generic issue |
| 0x02 | No Connection | Cannot reach FMD server |
| 0x04 | Device Error | FMD device error |
| 0x08 | Sensor Error | Data validation error |

### 8.2 Logging

```typescript
adapter.log.error(`FMD connection failed: ${err.message}`);
adapter.log.warn(`FMD response timeout, retrying...`);
adapter.log.info(`Ring command sent to device: ${deviceId}`);
adapter.log.debug(`Auth token expires in: ${expiresIn}s`);
```

## 9. Dependencies

### 9.1 NPM Packages

```json
{
  "dependencies": {
    "@iobroker/adapter-core": "^3.3.2",
    "axios": "^1.17.0"
  },
  "devDependencies": {
    "@iobroker/adapter-core": "^3.3.2",
    "@iobroker/testing": "^5.0.0",
    "@iobroker/adapter-dev": "^1.0.0",
    "@iobroker/eslint-config": "^1.0.0",
    "typescript": "~5.9"
  }
}
```

## 10. References

- [ioBroker Adapter Development](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterdev.md)
- [ioBroker JSON Config](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterjsonconfig.md)
- [FMD Server API](https://fmd-foss.org/docs/fmd-server)
- [FMD Python Client](https://github.com/devinslick/fmd_api)
