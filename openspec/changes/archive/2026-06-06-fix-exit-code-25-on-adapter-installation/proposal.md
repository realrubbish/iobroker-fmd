## Why

The ioBroker adapter fails to start after installation with **exit code 25** (module not found). The root cause is a mismatch between the declared main entry point in `io-package.json` (`build/index.js`) and the actual compiled output (`build/main.js`). This prevents ioBroker's js-controller from loading the adapter during the installation/daemon start phase.

## What Changes

- Fix `common.main` in `io-package.json` from `build/index.js` to `build/main.js`
- Verify `package.json` `main` field is also correct
- Add validation step to CI/build process to catch this mismatch in the future

## Capabilities

### New Capabilities
- `build-entrypoint-validation`: Add a build-time check that verifies the compiled entry point exists and matches the `main` field in `package.json` / `io-package.json`

### Modified Capabilities
- (none)

## Impact

- **Files modified**: `io-package.json`, `package.json` (verification only)
- **CI/CD**: New validation step in build pipeline
- **Breaking**: None — this is a critical bug fix

## Testing & Deployment

**Testing workflow** (always follow this sequence):

1. `git push` to trigger GitHub Actions CI (build + validation)
2. `docker compose up -d` — start/restart ioBroker container
3. `docker exec iobroker-fmd-dev iobroker url https://github.com/realrubbish/iobroker-fmd fmd` — install adapter from GitHub tarball
4. `docker exec iobroker-fmd-dev iobroker add fmd` — add adapter instance
5. `docker exec iobroker-fmd-dev iobroker logs fmd --files=20` — verify it starts

For hot-reload development: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
