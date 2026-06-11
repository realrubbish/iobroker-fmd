# Docker Development & Testing

## Deployment Workflow

**IMPORTANT:** Always follow this exact sequence for testing changes.

### 1. Commit & Push

```bash
git add <files>
git commit -m "fix: describe your change"
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
docker exec iobroker-fmd-dev iobroker url https://github.com/realrubbish/iobroker-fmd
```

This installs the adapter from GitHub (latest commit). The `iobroker url` command fetches the tarball from GitHub and runs npm install inside the container.

### 4. Fix Adapter Directory (Workaround)

Due to a known ioBroker issue with third-party GitHub adapters, npm installs the package as `iobroker.fmd` (with dot), but ioBroker expects `iobroker.iobroker-fmd` (with hyphen and `iobroker.` prefix). This workaround creates the expected directory structure:

```bash
docker exec iobroker-fmd-dev bash -c "\
  mkdir -p /opt/iobroker/node_modules/iobroker.iobroker-fmd && \
  cp -r /opt/iobroker/node_modules/iobroker.fmd/* /opt/iobroker/node_modules/iobroker.iobroker-fmd/ && \
  chown -R iobroker:iobroker /opt/iobroker/node_modules/iobroker.iobroker-fmd"
```

### 5. Upload & Register Adapter

```bash
docker exec iobroker-fmd-dev iobroker upload iobroker-fmd
```

### 6. Add Adapter Instance

```bash
docker exec iobroker-fmd-dev iobroker add iobroker-fmd
```

### 7. Configure & Enable

Open the Admin UI at http://localhost:8081, find the iobroker-fmd adapter instance, configure it with your FMD server credentials, and enable it.

### 8. Verify it Works

```bash
docker exec iobroker-fmd-dev iobroker logs iobroker-fmd --files=20
```

Click the `Ring Device` button in the wrench pop-up. The phone rings
within ~2 s. The reply is shown via `window.alert` on admin 7.7.22
(the native jsonConfig renderer) and via the same `window.alert` on
admin versions that load the Vite SPA in an iframe. The adapter-side
`onMessage.ring` handler in `src/main.ts` is the same in both cases.

## Common Issues

### Exit Code 25 on Installation

This means the entry point in `io-package.json` doesn't match the actual compiled output. Make sure `common.main` is set to `build/main.js` (not `build/index.js`).

### "Unknown packet name" / Adapter Not Recognized

If `iobroker list adapters` doesn't show the adapter after installation, the directory name workaround is needed (see Step 4 above). This is a known ioBroker issue with third-party GitHub adapters.

### Adapter Files Present but Not Recognized

If the adapter directory exists in `node_modules` but `iobroker list adapters` doesn't show it, the adapter object wasn't registered in ioBroker's objects DB. Run:

```bash
docker exec iobroker-fmd-dev iobroker upload iobroker-fmd
```

### Workaround Directory Wiped After `maintenance upgrade`

`maintenance upgrade -y` (the buanet Docker image's supported way to
upgrade `js-controller`) re-runs `npm install` against
`/opt/iobroker/package.json` and **deletes the `iobroker.iobroker-fmd`
workaround directory** that Step 4 created. After the controller
upgrade, the host starts logging:

```
startInstance cannot find adapter "iobroker-fmd@0.0.1". Try to install it... 1 attempt
iobroker npm-install: Unknown packet name iobroker-fmd
```

The `maintenance upgrade` does not know about the github-installed
adapter and cannot re-create the workaround. The recovery is the same
three commands as Step 4 plus the upload + start:

```bash
docker exec iobroker-fmd-dev bash -c "
  mkdir -p /opt/iobroker/node_modules/iobroker.iobroker-fmd && \
  cp -r /opt/iobroker/node_modules/iobroker.fmd/* /opt/iobroker/node_modules/iobroker.iobroker-fmd/ && \
  chown -R iobroker:iobroker /opt/iobroker/node_modules/iobroker.iobroker-fmd"
docker exec iobroker-fmd-dev iobroker upload iobroker-fmd
docker exec iobroker-fmd-dev iobroker start iobroker-fmd.0
```

Discovered 2026-06-11 during an E2E test session. Track this until
v1.0.0 lands on npm under the name `iobroker-fmd` (then the
workaround disappears and this gotcha goes with it — see
[Future: npm Publishing](#future-npm-publishing-v100) below).

## Future: npm Publishing (v1.0.0)

Once the adapter reaches version 1.0.0, it should be published to npm. This will simplify the installation workflow significantly:

```bash
#届时可以直接使用:
docker exec iobroker-fmd-dev iobroker add iobroker-fmd
#无需额外的目录结构修复步骤
```

**Publishing steps:**
1. Ensure `common.name` in `io-package.json` is `iobroker-fmd`
2. Run `npm run release patch` (or minor/major based on semver)
3. The release script will publish to npm automatically via GitHub Actions OIDC

See [ioBroker adapter publish documentation](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterpublish.md) for details.
