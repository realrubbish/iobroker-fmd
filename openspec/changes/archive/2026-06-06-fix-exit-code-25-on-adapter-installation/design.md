## Context

The adapter build process compiles `src/main.ts` → `build/main.js`, but `io-package.json` and `package.json` both declare `"main": "build/index.js"`. This mismatch causes ioBroker's js-controller to fail with exit code 25 when attempting to load the adapter.

## Goals / Non-Goals

**Goals:**
- Fix the entry point mismatch causing exit code 25
- Prevent future regressions with automated validation

**Non-Goals:**
- Restructure the adapter's module organization
- Change build tooling (stays with TypeScript + tsc)

## Decisions

1. **Change `common.main` in `io-package.json` from `build/index.js` to `build/main.js`**
   - Rationale: The compiled output IS `build/main.js`. The build config (`tsconfig.json`) outputs to `build/` with the same name as the source file.
   - Alternative: Create `build/index.js` that re-exports `main.js` — adds unnecessary indirection.

2. **Add build-time validation in CI**
   - Rationale: Catch mismatches before they reach users. A simple Node.js script that reads `main` from `package.json` and verifies the file exists.
   - Alternative: Fail the build entirely if entry point doesn't exist — more direct.

## Risks / Trade-offs

- **Risk**: Old installations may cache the broken config
  - **Mitigation**: Clear adapter cache via `iobroker clean all` or reinstall adapter after fix

## Deployment & Testing

The adapter is deployed from GitHub via `iobroker url`. The build output (`build/`) is committed to the repository so it's included in the GitHub tarball.

**Standard test sequence:**
```bash
git push
docker compose up -d
docker exec iobroker-fmd-dev iobroker url https://github.com/realrubbish/iobroker-fmd fmd
docker exec iobroker-fmd-dev iobroker add fmd
```

**Note:** The `iobroker url` command handles both npm install AND ioBroker internal adapter registration. Exit code 25 from this command indicates an entry point mismatch (the original bug this change fixes).
