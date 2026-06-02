---
name: branch-commit
description: Standard branch naming and commit message conventions for this project. Use when creating branches, writing commit messages, or reviewing git history. Triggers on "create branch", "commit message", "git commit", "branch name", "conventional commits".
disable-model-invocation: false
---

# Branch & Commit Conventions

## Branch Naming

Pattern: `<type>/<short-description>`

Use **kebab-case**, all lowercase, no spaces. Keep descriptions short (2–5 words).

| Type | When to use | Example |
|---|---|---|
| `feat/` | New feature or endpoint | `feat/user-profile-endpoint` |
| `fix/` | Bug fix | `fix/jwt-refresh-rotation` |
| `hotfix/` | Critical production fix | `hotfix/auth-token-expiry` |
| `chore/` | Tooling, deps, config, scripts | `chore/update-prisma-v7` |
| `refactor/` | Code restructure, no behaviour change | `refactor/posts-service-queries` |
| `test/` | Adding or fixing tests | `test/auth-e2e-coverage` |
| `docs/` | Documentation only | `docs/api-endpoints-readme` |
| `security/` | Security patches or hardening | `security/helmet-cors-config` |

### Rules
- Never commit directly to `main` or `master`
- Branch off `main` unless patching a release branch
- Delete branch after merging
- If tied to a ticket, optionally prefix with ticket number: `feat/AUTH-42-refresh-token-rotation`

---

## Commit Messages — Conventional Commits

Pattern:
```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature (triggers MINOR in semver) |
| `fix` | Bug fix (triggers PATCH in semver) |
| `chore` | Build process, tooling, dependencies — no production code |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or correcting tests |
| `docs` | Documentation only |
| `style` | Formatting, whitespace — no logic change |
| `perf` | Performance improvement |
| `ci` | CI/CD pipeline changes |
| `revert` | Reverts a previous commit |
| `security` | Security fix or hardening |

### Scopes for this project

Use the module name as scope:

| Scope | Covers |
|---|---|
| `auth` | Auth module, strategies, guards, JWT |
| `users` | Users module, service, controller |
| `posts` | Posts module, service, controller |
| `prisma` | PrismaService, schema, migrations |
| `common` | Filters, interceptors, guards, decorators |
| `config` | Environment, app config |
| `deps` | Dependency updates |
| `test` | Test files |

### Summary line rules
- **Imperative mood**: "add endpoint" not "added endpoint" or "adds endpoint"
- **Lowercase** first letter
- **No period** at the end
- **Max 72 characters**
- Describe **what** changed, not **how**

### Breaking changes
Add `!` after type/scope, and a `BREAKING CHANGE:` footer:
```
feat(auth)!: replace session tokens with JWT refresh rotation

BREAKING CHANGE: /auth/login no longer returns a session cookie.
Clients must store and send refresh_token from the response body.
```

---

## Examples for this project

```bash
# Feature
feat(auth): add forgot-password and reset-password endpoints

# Bug fix
fix(auth): delete expired refresh token before throwing 401

# Security
security(common): add helmet middleware and restrict CORS origins

# Chore
chore(deps): upgrade prisma from 7.6 to 7.8

# Refactor
refactor(users): replace double-query pattern with P2025 error handling

# Tests
test(auth): add e2e coverage for refresh token rotation

# Schema change
feat(prisma): add RefreshToken and PasswordResetToken models

# Breaking change
feat(auth)!: require refresh_token in logout request body

BREAKING CHANGE: POST /auth/logout now requires { refresh_token } in body.
Previously logout did not invalidate any token.
```

---

## Multi-commit PR checklist

Before opening a PR:
1. Each commit does **one thing** — squash WIP/fixup commits
2. Commit history reads like a changelog from bottom to top
3. No "fix typo", "oops", "wip" in final history — interactive rebase to clean up
4. Branch is up to date with `main`

### Squash fixups before pushing
```bash
git rebase -i main          # mark fixup commits as "fixup" or "squash"
git push --force-with-lease # safe force push to update remote branch
```

---

## Quick reference

```bash
# Create branch
git checkout -b feat/auth-change-password

# Stage and commit
git add src/auth/
git commit -m "feat(auth): add change-password endpoint with session invalidation"

# Amend last commit message (before push only)
git commit --amend -m "feat(auth): add change-password and invalidate all sessions"

# Push new branch
git push -u origin feat/auth-change-password
```
