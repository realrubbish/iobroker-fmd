## Context

The adapter needs proper packaging for distribution via npm and manual zip installation.

## Goals / Non-Goals

**Goals:**
- Clean npm package structure
- Proper .gitignore and .npmignore
- Release scripts

**Non-Goals:**
- Not implementing CI/CD (separate concern)
- Not setting up automatic releases

## Decisions

### Decision: Separate .gitignore and .npmignore
**Chosen:** .gitignore excludes build/, .npmignore excludes development files

**Rationale:**
- npm publish should be clean
- Git repo keeps everything

### Decision: Include LICENSE in package
**Chosen:** Add MIT LICENSE to root

## Files

| File | Purpose |
|------|---------|
| `.npmignore` | Files to exclude from npm package |
| `LICENSE` | MIT license |
