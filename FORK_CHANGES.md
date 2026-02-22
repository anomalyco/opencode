# Fork Divergences from upstream (anomalyco/opencode)

This document records all intentional divergences from the upstream repository.
Use it during merge conflict resolution to determine whether a conflict is
expected and which side should win.

Last updated: 2026-02-13
Merge base when created: b12eab78

---

## 1. Session Management — `packages/cloudsession/`

**What:** Custom Cloudflare Workers session storage replacing upstream's
session sharing infrastructure.

**Why:** Complete disconnect from upstream's session management servers.
All session data flows through our own R2 + Durable Object stack on
`opencode.j9xym.com`.

**Package:** `@opencode-ai/cloudsession` (fork-only, does not exist upstream)

**Merge impact:** None — upstream has no `packages/cloudsession/` directory.
Watch for SDK type changes in `packages/sdk/` that could break
`src/types.ts` re-exports.

**Files (merge=ours):**

- `packages/cloudsession/**`

---

## 2. SST Removed

**What:** Deleted `sst.config.ts` and all `sst-env.d.ts` files (11 total).
Deployment uses direct Cloudflare Workers via wrangler.

**Why:** Fork manages infrastructure through wrangler configs, not SST.

**Merge impact:** When upstream modifies `sst.config.ts` or regenerates
`sst-env.d.ts`, resolve as "deleted by us" (`git rm`). Rerere remembers
this decision.

**Related:** Console/enterprise packages excluded from typecheck since
they depend on SST-generated `Resource.*` types we no longer generate.
See `package.json` root script: `typecheck` uses turbo `--filter` to
skip `@opencode-ai/console-*` and `@opencode-ai/enterprise`.

---

## 3. GitHub Integrations Removed

**What:** GitHub Actions workflows disabled (`.yml` → `.yml.disabled`).
The `github/` directory (GitHub Agent) is present but not deployed.

**Why:** Fork does not use upstream's GitHub App integration.

**Merge impact:** When upstream modifies `.github/workflows/*.yml`,
resolve as "deleted by us" for workflows we disabled. New workflows
from upstream can be accepted and disabled separately.

---

## 4. Environment Variables & Network Filter

**What:** Fork-specific environment variables override upstream defaults
to point at fork infrastructure (`j9xym.com`).

| Variable        | Fork Value                       | Upstream Default          |
| --------------- | -------------------------------- | ------------------------- |
| `OPENCODE_API`  | `https://api.opencode.j9xym.com` | `https://api.opencode.ai` |
| `OIDC_BASE_URL` | `https://api.opencode.j9xym.com` | `https://api.opencode.ai` |
| `WEB_DOMAIN`    | `opencode.j9xym.com`             | `opencode.ai`             |
| `API_DOMAIN`    | `api.opencode.j9xym.com`         | `api.opencode.ai`         |

**Network filter** (`packages/opencode/src/util/network.ts`):
Blocks upstream `opencode.ai` domains, allows fork `j9xym.com` domains.

**Files (merge=ours):**

- `packages/opencode/.env.example`
- `packages/opencode/src/util/network.ts`
- `packages/opencode/src/share/**`

---

## 5. Web Package — SolidJS + Hono Rewrite

**What:** `packages/web/` was rewritten from upstream's Astro SSR to a
SolidJS client + Hono worker architecture with Cloudflare Workers
deployment.

**Why:** Better alignment with fork's Cloudflare-native infrastructure
and session management.

**Merge impact:** Upstream continues to evolve their Astro-based web
package. Accept upstream changes to shared components/content, but keep
fork's infrastructure files.

**Files (merge=ours):**

- `packages/web/wrangler.jsonc`
- `packages/web/vite.config.ts`
- `packages/web/src/worker.ts`
- `packages/web/README.md`

---

## 6. Wrangler Configurations

**What:** Fork-specific wrangler.jsonc files for Cloudflare Workers deployment.

| File                                   | Worker Name             | Domain                   |
| -------------------------------------- | ----------------------- | ------------------------ |
| `packages/cloudsession/wrangler.jsonc` | `opencode-sessions-api` | `opencode.j9xym.com`     |
| `packages/web/wrangler.jsonc`          | `opencode-web`          | `opencode.j9xym.com`     |
| `packages/function/wrangler.jsonc`     | (api)                   | `api.opencode.j9xym.com` |

**Merge impact:** Upstream has no wrangler configs at these paths.
No conflicts expected.

---

## 7. Docs Backup

**What:** Upstream's `packages/docs/` content backed up to
`.opencode/docs-backup/` before merges.

**Why:** Preserve fork documentation that may diverge from upstream.

---

## Merge Cheat Sheet

```bash
# Enable rerere (remembers conflict resolutions)
git config rerere.enabled true
git config rerere.autoupdate true

# Register ours merge driver (keeps fork version for marked files)
git config merge.ours.driver true

# --- Upstream sync: merge release tags ---
git fetch upstream --tags
git checkout dev && git merge --ff-only upstream/dev   # keep dev as clean mirror
git checkout main && git merge v1.2.XX -m "upstream: sync to v1.2.XX"

# --- For "deleted by us" conflicts (SST files, disabled workflows):
git rm <file>

# --- After merge, always regenerate lockfile:
bun install

# --- Feature branches: merge with --no-ff ---
git checkout main
git merge --no-ff feat/my-feature -m "feat: description"

# --- Urgent upstream fix between releases:
git cherry-pick <upstream-commit-hash>

# --- Typecheck (excludes console/enterprise packages):
bun run typecheck
```
