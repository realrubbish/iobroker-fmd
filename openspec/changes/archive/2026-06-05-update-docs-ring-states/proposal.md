## Why

The `fmd-ring` change updated the ring trigger from `fmd.0.ring.<deviceId>` to `0_userdata.0.FindMyDevice.ring.<deviceId>`, but several documentation files still reference the old state paths.

## What Changes

- Update `Architecture.md` state table to reflect new ring state path
- Update `Brand.md` OID examples
- Update `Visual.md` OID and setState examples
- Update `User-Experience.md` state table
- Update `Research.md` OID examples
- Update `README.md` OID and setState examples

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- None (documentation only, no spec changes)

## Impact

- Updated documentation files in `docs/`
- No code changes
