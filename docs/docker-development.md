# Docker Development & Testing

## Deployment Workflow

**IMPORTANT:** Always follow this exact sequence for testing changes:

### 1. Commit & Push

```bash
git add <files>
git commit -m "fix: correct entry point from build/index.js to build/main.js"
git push
```

### 2. Start/Restart Docker Container

```bash
docker compose up -d
# or restart if already running:
docker compose restart
```

### 3. Install Adapter in Container

```bash
docker exec iobroker-fmd-dev iobroker url https://github.com/realrubbish/ioBroker-FMD-adapter fmd
```

This installs the adapter from GitHub (latest commit). The `iobroker url` command fetches the tarball from GitHub and runs npm install inside the container.

### 4. Add Adapter Instance

```bash
docker exec iobroker-fmd-dev iobroker add fmd
```

### 5. Configure & Enable

Open the Admin UI at http://localhost:8081, find the fmd adapter instance, configure it with your FMD server credentials, and enable it.

### 6. Verify it Works

```bash
docker exec iobroker-fmd-dev iobroker logs fmd --files=20
```

## Common Issues

### Exit Code 25 on Installation

This means the entry point in `io-package.json` doesn't match the actual compiled output. Make sure `common.main` is set to `build/main.js` (not `build/index.js`).

### "Unknown packet name"

The `iobroker url` command handles both npm install AND ioBroker internal registration. If you see this error after a successful npm install, it's an ioBroker internal issue with third-party adapters — try:

```bash
docker exec iobroker-fmd-dev iobroker restart
docker exec iobroker-fmd-dev iobroker add fmd
```

### Adapter Files Present but Not Recognized

If the adapter directory exists in `node_modules` but `iobroker list adapters` doesn't show it, the adapter object wasn't registered in ioBroker's objects DB. Restart the container to force rediscovery.

## Dev Hot Reload

For live development with file changes synced into the container:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This mounts the local source into the container's `node_modules/iobroker.fmd` path. After changing source, rebuild locally:

```bash
npm run build
```

The changes are immediately reflected in the running container.
