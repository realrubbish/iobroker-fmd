## Why

The ioBroker adapter needs a proper distribution package structure for installation via npm and for manual installation as a zip file.

## What Changes

- Create proper npm package structure (io-package.json already exists)
- Add build output to .gitignore
- Add release script to package.json
- Create .npmignore for clean npm publish
- Add LICENSE file to root

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- None

## Impact

- Updated `.gitignore` and `.npmignore`
- Updated `package.json` with release scripts
- New `LICENSE` file
