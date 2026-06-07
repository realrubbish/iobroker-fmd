## Context

The `fmd-ring` change introduced ring states under `0_userdata.0.FindMyDevice` instead of `iobroker-fmd.0`. Several documentation files still reference the old path `iobroker-fmd.0.ring`.

## Goals / Non-Goals

**Goals:**
- Update all documentation references from `iobroker-fmd.0.ring` to `0_userdata.0.FindMyDevice.ring`
- Maintain documentation consistency

**Non-Goals:**
- No code changes
- No new functionality

## Decisions

### Decision: Use sed for bulk replacement
**Chosen:** Use replace_all to update all occurrences

**Rationale:**
- Simple pattern matching
- No complex logic needed

## Files to Update

| File | Changes |
|------|---------|
| `docs/Architecture.md` | State table |
| `docs/Brand.md` | OID examples |
| `docs/Visual.md` | OID and setState examples |
| `docs/User-Experience.md` | State table |
| `docs/Research.md` | OID examples |
| `docs/README.md` | OID and setState examples |

## Migration

1. Replace `iobroker-fmd.0.ring` with `0_userdata.0.FindMyDevice.ring` in all files
2. Verify no references remain
