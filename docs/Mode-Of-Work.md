# Mode-Of-Work.md - ioBroker-fmd-adapter

## 1. Workflow Overview

This document describes how work is organized and executed for the ioBroker-fmd-adapter project.

## 1.5 OpenSpec Integration

This project uses OpenSpec for change management. All features must go through the OpenSpec workflow:

```
/opsx:propose <name>  →  Creates change skeleton
                         ↓
                         User reviews and refines proposal, design, specs
                         ↓
/opsx:apply           →  Implementation phase (tasks checked off as done)
                         ↓
                         All tasks complete → /opsx:archive
```

**Key Principles:**
- Each change has its own folder under `openspec/changes/<name>/`
- Tasks are tracked in `tasks.md` with checkboxes
- Implementation only happens AFTER all artifacts (proposal, design, specs, tasks) are complete
- After `/opsx:apply` completes all tasks, offer `/opsx:archive` - do NOT ask "what next"
- No feature implementation outside of an approved change

**💡 Before Starting a New Change:**
- Run `/clear` to start with a clean slate
- Then run `/opsx:propose <name>` to create the change skeleton

**💡 After Completing a Change:**
- Run `/clear` to reset context before the next task or change

## 2. Chunk-Based Work

### 2.1 Principle

All work is divided into small, logical chunks. After each chunk, work stops for manual user review before proceeding.

### 2.2 What Defines a Chunk

A chunk is a **single logical change** that:
- Can be described in one commit message
- Is self-contained (no half-implemented features)
- Passes all tests before review
- Includes documentation if needed

### 2.3 Chunk Examples

| Chunk | Description |
|-------|-------------|
| "Add FMD authentication module" | Complete auth implementation |
| "Implement ring command API call" | Complete API integration |
| "Add error state indicators" | Complete error handling feature |
| "Write unit tests for auth" | Complete test suite |

### 2.4 NOT a Chunk

- "Implement everything at once"
- "Fix some bugs and add features"
- "Work on multiple unrelated things"

## 3. Git Workflow

### 3.1 Branch Strategy

```
main                    # Production-ready code
├── feature/ring-cmd    # Feature branch
├── feature/auth        # Feature branch
└── bugfix/token-refresh # Bugfix branch
```

**Rules:**
- ❌ Never push directly to `main`
- ✅ Create feature branches for each chunk
- ✅ Use PR for code review
- ✅ Delete branch after merge

### 3.2 Commit Rules

**Format:** `type(scope): description`

```
feat(auth): add FMD authentication with Argon2id
fix(api): handle token expiration gracefully
docs(readme): add installation instructions
test(ring): add unit tests for ring command
```

**Commit Types:**
| Type | When to Use |
|------|-------------|
| `feat` | New feature for the user |
| `fix` | Bug fix for the user |
| `docs` | Documentation only changes |
| `style` | Formatting, no semantic change |
| `refactor` | Code change without feature/fix |
| `perf` | Performance improvement |
| `test` | Adding or correcting tests |
| `chore` | Build process, tools |
| `build` | Dependencies |
| `ci` | CI configuration |
| `revert` | Reverting previous commit |

### 3.3 Prohibited Operations

| Operation | Why |
|-----------|-----|
| `git commit --amend` | Rewrites history; creates confusion |
| `git push --force` | Can destroy others' work |
| Auto-commit | User must review each change |
| Auto-push | Same reason |

### 3.4 After Each Chunk

1. **Present summary** to user
2. **Wait for review/approval**
3. **Commit only when user says to**
4. **Push only when user says to**

## 4. Development Process

### 4.1 Step-by-Step Workflow

```
1. Understand requirement
   ↓
2. Check current documentation
   ↓
3. Plan implementation (small chunk)
   ↓
4. Implement code
   ↓
5. Write tests
   ↓
6. Update docs if needed
   ↓
7. Present for review
   ↓
8. Wait for user approval
   ↓
9. Commit (user-triggered)
   ↓
10. Push (user-triggered)
   ↓
11. Next chunk...
```

### 4.2 Verification Checklist

Before presenting a chunk for review:

- [ ] Code compiles without errors
- [ ] All tests pass (`npm test`)
- [ ] ESLint passes (`npm run lint`)
- [ ] TypeScript type checking passes
- [ ] Documentation updated if needed
- [ ] No console.log/debugger left
- [ ] Commit message follows Conventional Commits

## 5. Communication Rules

### 5.1 Don't Assume

| Instead of assuming... | Do this |
|------------------------|---------|
| "I know what the user wants" | Ask clarifying questions |
| "This library works this way" | Verify with documentation |
| "This is the right approach" | Explain reasoning, ask for input |
| "The API is probably..." | Check the actual API |

### 5.2 Build Common Understanding

Before implementing:
- Confirm understanding of requirements
- Discuss approach and alternatives
- Agree on acceptance criteria

### 5.3 Present Summary After Chunk

After completing each chunk, present:

```
## Chunk Complete: [Title]

### What was done
- [List of changes]

### Files modified
- [List of files]

### Tests added
- [List of tests]

### Documentation updated
- [List of docs]

### Next steps
- [What comes next]

### Ready for review ✓
```

## 6. Documentation Rules

### 6.1 Why Comments

Because this is a **public repository**, every architectural decision must be documented:
- WHY this approach was chosen
- WHY this library was selected
- WHY the code is structured this way

### 6.2 Required Documentation

| Change Type | Documentation Required |
|-------------|----------------------|
| New feature | Feature description + usage example |
| API change | Update relevant docs |
| Architecture change | Explain WHY in code comments |
| Configuration change | Update README/Architecture.md |

## 7. Version Control Commands Reference

### 7.1 Creating a Feature Branch

```bash
git checkout -b feature/ring-command
```

### 7.2 Committing Changes

```bash
git add .
git commit -m "feat(api): add ring command support"
```

### 7.3 Merging a Feature

```bash
git checkout main
git merge feature/ring-command
git branch -d feature/ring-command
```

### 7.4 Creating a Release

```bash
npm run release patch  # or minor, major
```

## 8. References

- [Conventional Commits](https://www.conventionalcommits.org)
- [Pro Git Book - Topic Branches](https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows)
- [ioBroker create-adapter](https://github.com/ioBroker/create-adapter)
