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

### Admin UI

The adapter uses the modern JSON Config interface (ioBroker Admin 7+):

```
┌─────────────────────────────────────────────────────┐
│ FMD Connection                                      │
│ ├─ Server URL: [https://fmd.example.com        ]   │
│ ├─ Username:   [admin                        ]   │
│ └─ Password:   [••••••••••                    ]   │
│                                                      │
│ Notifications                                        │
│ └─ □ Send notification on errors                    │
└─────────────────────────────────────────────────────┘
```

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

### Connection errors

- Check network connectivity to FMD server
- Verify firewall allows connections
- Ensure FMD server is not blocked

## Security

- Passwords are stored using ioBroker's `encryptedNative`
- Credentials are encrypted at rest
- Only accessible by this adapter instance

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

# 2. Start the Docker container
docker compose up -d

# 3. Install adapter from GitHub
docker exec iobroker-fmd-dev iobroker url https://github.com/realrubbish/iobroker-fmd

# 4. Fix adapter directory (workaround for ioBroker GitHub adapter issue)
docker exec iobroker-fmd-dev bash -c "\
  mkdir -p /opt/iobroker/node_modules/iobroker.iobroker-fmd && \
  cp -r /opt/iobroker/node_modules/iobroker.fmd/* /opt/iobroker/node_modules/iobroker.iobroker-fmd/ && \
  chown -R iobroker:iobroker /opt/iobroker/node_modules/iobroker.iobroker-fmd"

# 5. Upload and register adapter
docker exec iobroker-fmd-dev iobroker upload iobroker-fmd

# 6. Add adapter instance
docker exec iobroker-fmd-dev iobroker add iobroker-fmd

# 7. Verify
docker exec iobroker-fmd-dev iobroker logs iobroker-fmd --files=20
```

**Note:** Step 4 is a workaround for a known ioBroker issue where third-party GitHub adapters are installed with the wrong directory name. Once the adapter is published to npm (planned for v1.0.0), this step will no longer be needed.

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
