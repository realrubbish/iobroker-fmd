# ioBroker.fmd

[![NPM Version](https://img.shields.io/npm/v/iobroker.fmd?style=flat-square)](https://www.npmjs.com/package/iobroker.fmd)
[![Downloads](https://img.shields.io/npm/dm/iobroker.fmd?style=flat-square)](https://www.npmjs.com/package/iobroker.fmd)
[![Test and Release](https://github.com/iobroker-community-adapters/iobroker.fmd/workflows/Test%20and%20Release/badge.svg)](https://github.com/iobroker-community-adapters/iobroker.fmd)
[![License](https://img.shields.io/github/license/iobroker-community-adapters/iobroker.fmd?style=flat-square)](LICENSE)

Ring FMD (Find My Device) devices via your ioBroker installation using hardware buttons or software widgets.

## Overview

The ioBroker.fmd adapter integrates your FMD server with ioBroker, enabling you to locate devices by triggering ring commands through physical buttons (e.g., Shelly) or vis-2 Dashboard software buttons.

## Features

- **Hardware Button Trigger**: Ring your phone with a Shelly button press
- **Software Button**: Add a ring button to your vis-2 Dashboard
- **Secure Credentials**: Passwords stored encrypted via ioBroker
- **Multiple Devices**: Support for multiple FMD devices
- **Error Feedback**: Clear error states and notifications
- **Easy Integration**: Works with existing ioBroker scripts

## Requirements

- Node.js >= 18
- js-controller >= 5.0.0
- admin adapter >= 7.0.0
- FMD server (self-hosted or server.fmd-foss.org)
- FMD app on your phone

## Installation

Install the adapter via ioBroker Admin or:

```bash
npm install iobroker.fmd
```

## Configuration

1. Open ioBroker Admin → Instances
2. Click "+" to add new instance
3. Select "FMD (Find My Device)" adapter
4. Configure the instance:

| Setting | Description |
|---------|-------------|
| FMD Server URL | Your FMD server URL (e.g., `https://fmd.example.com`) |
| Username | Your FMD account username |
| Password | Your FMD account password |
| Default Ring Device | (Optional) Device ID to ring when the configured button trigger fires. Leave empty to ring only manually. |
| Button State ID | (Optional) State ID of a Shelly (or other) button whose `triple_push` event triggers a ring. Leave empty to disable the hardware button path. |

### Admin UI

The adapter ships its own admin UI built with React + Vite and the
`@iobroker/json-config` form component. The wrench pop-up on the
instance row shows three panels:

```
┌─────────────────────────────────────────────────────┐
│ FMD (Find My Device)                                │
│                                                     │
│ ▾ Connection                                        │
│   ├─ FMD Server URL: [https://fmd.example.com  ]    │
│   ├─ Username:        [admin                  ]     │
│   └─ Password:        [••••••••               ]     │
│                                                     │
│ ▾ Hardware Button Trigger                           │
│   ├─ Default Ring Device: [3f6c1b8a           ]     │
│   ├─ Button State ID:     [shelly.0.…Event    ]     │
│   └─ Hint: When Button State ID changes to          │
│      "triple_push", the adapter rings the            │
│      Default Ring Device.                            │
│                                                     │
│ ▾ Connection Status                                 │
│   ├─ Status:       connected (live)                  │
│   ├─ Last Error:   —                                 │
│   └─ [ Test Connection ]                             │
│                                                     │
│ ▾ Devices                                           │
│   ├─ Available Ring States:                          │
│   │   • my-phone (val=true)                          │
│   │   • my-tablet (val=false)                        │
└─────────────────────────────────────────────────────┘
```

The Status and Devices panels refresh every 5 seconds. Use the
`Test Connection` button in the Status panel to verify your
credentials without restarting the adapter. See
[`docs/admin-ui.md`](docs/admin-ui.md) for the build pipeline,
architecture, and module-federation contract.

## Usage

### Hardware Button (Shelly)

Trigger the ring command when a Shelly button is pressed:

```javascript
// In a ioBroker JavaScript (javascript.0)
on({id: 'shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event', val: 'triple_push'}, function() {
    sendTo('iobroker-fmd.0', 'ring', { device: 'my-phone' });
});
```

Or with async/await:

```javascript
on({id: 'shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event', val: 'triple_push'}, async function() {
    await sendToAsync('iobroker-fmd.0', 'ring', { device: 'my-phone' });
});
```

### vis-2 Dashboard Button

Add a button widget to your vis-2 Dashboard:

**Widget JSON:**
```json
{
  "oid": "0_userdata.0.FindMyDevice.ring",
  "value": "my-phone",
  "label": "Find Phone"
}
```

**Via JavaScript:**
```javascript
// Ring a specific device
setState('0_userdata.0.FindMyDevice.ring', 'my-phone');

// Or with sendTo
sendTo('iobroker-fmd.0', 'ring', { device: 'my-phone' });
```

### Available States

| State | Type | Description |
|-------|------|-------------|
| `iobroker-fmd.0.info.connection` | boolean | FMD server reachable |
| `iobroker-fmd.0.info.error` | boolean | Error indicator |
| `iobroker-fmd.0.info.lastError` | string | Last error message |
| `0_userdata.0.FindMyDevice.ring` | string | Ring command (device ID) |
| `iobroker-fmd.0.devices` | object | Available FMD devices |

## Architecture

```
[Shelly Button] ──MQTT──> [ioBroker] ──API──> [FMD Server] ──ntfy──> [Phone]
     │                                                       │
     └──────── triple_push ──────────────────────────────────┘
                                     │
                              Ring command sent!
```

### Authentication Flow

```
1. Request salt from FMD server
2. Derive key with Argon2id (password + salt)
3. Exchange for access token
4. Retrieve and decrypt private key
5. Sign requests with RSA-PSS
```

## Troubleshooting

### Docker Troubleshooting

#### Volume mount not reflecting changes

If you need to refresh adapter files after a code change:
- Reinstall via: `docker exec iobroker-fmd-dev iobroker url https://github.com/realrubbish/iobroker-fmd`
- Apply directory workaround (see Docker-Based Testing step 4)
- Restart the container: `docker compose restart`

#### Port already in use

If `IOBROKER_PORT` is already in use:
- Change the port in `.env`: `IOBROKER_PORT=9081`
- Access ioBroker at `http://localhost:9081`

#### Docker permission errors

If you encounter permission issues:
- Ensure Docker Desktop is running
- Try: `docker compose down` then `docker compose up -d`
- On Linux, you may need to add your user to the `docker` group

### Adapter won't start

1. Check logs: `iobroker logs iobroker-fmd.0`
2. Verify FMD server URL is accessible
3. Check credentials are correct

### Ring command not working

1. Ensure FMD server is running
2. Check device ID is correct
3. Verify phone has FMD app installed and configured

#### How ring signing works

When you trigger a ring, the adapter posts the bare command string
`ring` to the FMD server's `POST /api/v1/command` endpoint. The
request body carries `IDT` (access token), `Data` (the command),
`UnixTime` (milliseconds since epoch), and `CmdSig` (an RSA-PSS
signature over the string `${UnixTime}:${Data}`) — **all four
fields go in the JSON body, not in HTTP headers**. The FMD server
stores the pending command and pushes a wakeup ping via ntfy to the
device app. The device app then polls `GET /api/v1/command`,
verifies the signature with the user's public key, parses the
command, and rings the phone only if everything matches.

**The command keyword is `ring`, not `ring:<deviceId>`.** The FMD
Android client routes commands per access-token-owner (the device
is implicit) and its `CommandParser` matches the second
space-separated token against each registered keyword. Sending
`ring:<id>` results in no keyword match and is silently dropped —
the server returns 200 OK, the phone wakes, polls, and the parser
finds nothing to dispatch.

If the adapter logs `Ring command sent to device: <id>` but the
phone does not ring, walk the diagnostic ladder:

1. **Run the offline self-test** (`npm run ring:smoke:verify`) to
   confirm the local sign-then-verify round-trip succeeds. If this
   fails, the PSS parameters have drifted.
2. **Run the live smoke** (`npm run ring:smoke`) against your FMD
   server. Exit 0 means the server accepted the request and the
   command landed in the queue.
3. **Check the ntfy push URL** is configured on your account and
   the phone's UnifiedPush distributor is connected. The server
   sends a `{"message": "fmd app wakeup"}` ping; if the phone never
   wakes, the push channel is broken (most often Akku-Optimierung
   killing the app or a missing UnifiedPush distributor).
4. **Check the device app's debug log** for
   `Failed to verify the signature` or
   `TriggerWordMismatch` / no-keyword-match notices.

From the dev host, run the live smoke as:

```bash
FMD_SERVER_URL=https://fmd.example.com \
FMD_USERNAME=<user> FMD_PASSWORD=<pw> FMD_DEVICE_ID=<id> \
  npm run ring:smoke
```

The script prints `OK server accepted ring command` and exits 0
on a structurally valid request. Note that this only confirms
"the server accepted the request" — the device app is the only
ground truth for "the phone will ring". See
`scripts/ring-smoke.mjs` for the full list of exit codes and
limitations.

The ring signing itself uses [`node-forge`](https://github.com/digitalbazaar/forge)
with all four RSA-PSS parameters pinned explicitly — hash
(SHA-256), MGF1 hash (SHA-256), salt length (32), and trailer
field (1) — to match the FMD Android verifier's
`PSSParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256,
32, 1)`. If you suspect PSS parameter drift (e.g. after a
`node-forge` major upgrade or a refactor of `FmdApi.signRequest`),
run the offline sign-then-verify round-trip:

```bash
npm run ring:smoke:verify
```

This generates a throwaway 2048-bit RSA key pair, signs a fixed
payload with the same code path the adapter uses, then verifies
the signature with the same PSS profile. It exits 0 on success
and 1 on a PSS-decoding failure (the latter is what you get when
any of the four parameters drift between signer and verifier).
The mode runs entirely offline — no `FMD_*` env vars, no
network, no credentials.

### Connection errors

- Check network connectivity to FMD server
- Verify firewall allows connections
- Ensure FMD server is not blocked

## Security

- Passwords are stored using ioBroker's `encryptedNative`
- Credentials are encrypted at rest
- Only accessible by this adapter instance

## Dependencies

The adapter has four runtime dependencies:

| Dependency | Purpose | Size note |
|---|---|---|
| `@iobroker/adapter-core` | ioBroker adapter framework | — |
| `axios` | HTTP client for FMD server requests | — |
| `hash-wasm` | Argon2id KDF for the FMD auth flow | small WASM blob |
| `node-forge` | RSA-PSS sign+verify with all four PSS knobs exposed (used in `FmdApi.signRequest` and the offline `--verify` smoke) | ~600 kB minified |

`node-forge` is the largest dependency; we use only its
`pki` / `pss` / `mgf` / `md` / `asn1` / `util` namespaces (roughly
5% of the library). It is the only pure-JS RSA implementation that
exposes all four PSS parameters by name — see
`docs/admin-ui.md` and the `fix-ring-signing-followup` change
notes for the full rationale. The adapter ships as a tarball via
`iobroker url` so the install-time cost is the only cost.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## License

MIT License

Copyright 2024-2026 ioBroker-fmd-adapter contributors

## Links

- [FMD Server](https://gitlab.com/fmd-foss/fmd-server)
- [FMD Documentation](https://fmd-foss.org/docs/fmd-server)
- [FMD Android App](https://fmd-foss.org/docs/fmd-android/push)
- [ioBroker Adapter Development](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterdev.md)
- [Python Reference (fmd_api)](https://github.com/devinslick/fmd_api)

## Development

### Docker-Based Testing

To test changes in a Docker container, follow this workflow:

```bash
# 1. Commit and push your changes
git add <files>
git commit -m "fix: describe your change"
git push

# 2. Build the admin UI (mandatory when src-admin/ or admin/index*.html changed)
npm run build:admin

# 3. Start the Docker container
docker compose up -d

# 4. Install adapter from GitHub
docker exec iobroker-fmd-dev iobroker url https://github.com/realrubbish/iobroker-fmd

# 5. Fix adapter directory (workaround for ioBroker GitHub adapter issue)
docker exec iobroker-fmd-dev bash -c "\
  mkdir -p /opt/iobroker/node_modules/iobroker.iobroker-fmd && \
  cp -r /opt/iobroker/node_modules/iobroker.fmd/* /opt/iobroker/node_modules/iobroker.iobroker-fmd/ && \
  chown -R iobroker:iobroker /opt/iobroker/node_modules/iobroker.iobroker-fmd"

# 6. Upload and register adapter
docker exec iobroker-fmd-dev iobroker upload iobroker-fmd

# 7. Force io-package.json refresh (mandatory when io-package.json changed)
docker exec iobroker-fmd-dev touch /opt/iobroker/iobroker-data/files/iobroker-fmd/io-package.json

# 8. Add adapter instance (only on first install or after adapter-name change)
docker exec iobroker-fmd-dev iobroker add iobroker-fmd

# 9. Verify
docker exec iobroker-fmd-dev iobroker logs iobroker-fmd --files=20
# In the browser: hard-reload ioBroker.admin (Cmd/Ctrl+Shift+R) and click
# the wrench on iobroker-fmd.0 — the new admin/index.html must load.
```

**Note:** Step 5 is a workaround for a known ioBroker issue where third-party GitHub adapters are installed with the wrong directory name. Once the adapter is published to npm (planned for v1.0.0), this step will no longer be needed.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- At least 4GB RAM allocated to Docker Desktop

### Port Configuration

Edit the `.env` file to change default ports:

```bash
IOBROKER_PORT=9081  # ioBroker admin on port 9081 instead of 8081
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Lint

```bash
npm run lint
```

### Release

```bash
npm run release patch  # or minor, major
```
