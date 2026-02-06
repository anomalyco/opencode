# Fork Feature Audit (Restored Inventory)

Purpose: track **all** fork deltas and keep them preserved during upstream merges. This file is the authoritative checklist for fork features and should be updated whenever fork behavior changes.

## Status
- Snapshot date: 2026-02-06
- Base comparison: `upstream/dev...dev`
- Current divergence: `0` behind / `429` ahead (`git rev-list --left-right --count upstream/dev...dev`)
- `parent-dev` mirror: `0 0` (`git rev-list --left-right --count upstream/dev...parent-dev`)
- Source artifacts: `docs/upstream-sync/restore-missing-commits.txt`, `docs/upstream-sync/restore-file-map.txt`
- Catch-up status: upstream catch-up is complete; this file reflects post-catch-up decoupling restoration from `sync/decouple-fork-layer`.
- Continuous sync status: `.github/workflows/sync-upstream.yml` active; `parent-dev` stays mirrored to `upstream/dev`.

## A. System Authentication & Security (Core Runtime)

### A0. Server auth config loader
- Files:
  - `packages/fork-auth/src/config.ts`
  - `packages/fork-auth/src/server-auth.ts`
  - `packages/fork-auth/src/index.ts` (validateAuthConfig)
  - `packages/fork-config/src/index.ts`
  - `packages/opencode/src/config/auth.ts` (re-export)
  - `packages/opencode/src/config/config.ts` (hook usage)
  - `packages/opencode/src/config/server-auth.ts` (re-export)
- Behavior:
  - Loads auth config at server startup without Instance context.
  - Validates auth config during config parsing.
  - Extends config schema for auth/workspace/uiUrl and applies workspace defaults.

### A1. Auth broker (PAM, setuid root)
- Files:
  - `packages/fork-auth/src/auth/**`
  - `packages/fork-auth/src/routes/auth.ts`
  - `packages/opencode/src/server/routes/auth.ts` (re-export)
  - `packages/opencode-broker/**`
  - `docs/pam-config.md`
- Behavior:
  - PAM authentication via privileged broker.
  - Broker spawns user processes with UID/GID and manages PTY allocation.
- Entrypoints:
  - `packages/fork-auth/src/auth/broker-client.ts`
  - `packages/fork-auth/src/routes/auth.ts`
  - `packages/opencode/src/server/routes/pty.ts`
- Tests:
  - `packages/fork-tests/server/routes/pty-broker.test.ts`
  - `packages/fork-tests/integration/user-process.test.ts`

### A2. Session auth middleware + cookies
- Files:
  - `packages/fork-auth/src/middleware/auth.ts`
  - `packages/fork-auth/src/middleware/csrf.ts`
  - `packages/opencode/src/server/middleware/auth.ts` (re-export)
  - `packages/opencode/src/server/middleware/csrf.ts` (re-export)
- Behavior:
  - Session cookies, CSRF protection, auth-required gating.
- Tests:
  - `packages/fork-tests/server/middleware/csrf.test.ts`

### A3. 2FA/TOTP (PAM OTP)
- Files:
  - `packages/fork-auth/src/auth/totp-setup.ts`
  - `packages/fork-auth/src/auth/two-factor-token.ts`
  - `packages/fork-auth/src/routes/auth.ts`
  - `packages/opencode-broker/service/opencode-otp.pam*`
- Tests:
  - `packages/fork-tests/server/routes/auth.test.ts`

### A4. Security hardening
- Files:
  - `packages/fork-auth/src/security/https-detection.ts`
  - `packages/fork-auth/src/security/rate-limit.ts`
  - `packages/fork-security/src/index.ts`
  - `packages/opencode/src/server/security/https-detection.ts` (re-export)
  - `packages/opencode/src/server/security/rate-limit.ts` (re-export)
  - `packages/opencode/src/server/security/csrf.ts` (re-export)
  - `packages/opencode/src/server/security/token-secret.ts` (re-export)
- Behavior:
  - HTTPS detection (trust proxy), insecure login warning/block, rate limiting.
- Tests:
  - `packages/fork-tests/server/security/https-detection.test.ts`
  - `packages/fork-tests/server/security/rate-limit.test.ts`

## B. CLI & TUI Additions

### B1. Auth broker CLI commands
- Files:
  - `packages/fork-cli/src/auth-broker.ts`
  - `packages/fork-cli/src/error.ts`
  - `packages/opencode/src/cli/cmd/auth.ts` (hook registration)
  - `packages/opencode/src/cli/error.ts` (fork error hook)
- Behavior:
  - `opencode auth broker setup/status` (PAM file installation, broker status).

### B2. Web CLI local UI bundling + mDNS label override
- Files:
  - `packages/fork-cli/src/web.ts`
  - `packages/opencode/src/cli/cmd/web.ts` (hook usage)
  - `packages/opencode/src/server/server.ts` (uiDir hook usage)
  - `packages/opencode/src/server/ui-dir.ts`
- Behavior:
  - Builds and serves local web UI when needed; uses `opencode.local` for mDNS display.

### B3. CLI branding override
- Files:
  - `packages/fork-cli/src/logo.ts`
  - `packages/opencode/src/cli/ui.ts` (hook usage)
  - `packages/opencode/src/cli/logo.ts` (upstream glyphs)
- Behavior:
  - Custom fork ASCII logo in CLI.

### B4. Run command behavior
- Files:
  - `packages/fork-cli/src/run.ts`
  - `packages/opencode/src/cli/cmd/run.ts` (hook usage)
- Behavior:
  - Fork-specific run output formatting, permission prompts, and idle handling.

### B5. TUI updates for auth and permissions
- Upstream/no fork-specific changes detected.
- Notes:
  - TUI worker auth-header injection uses the upstream-local helper in `packages/opencode/src/cli/cmd/tui/worker.ts`.
  - Fork TUI hook surface has been removed.

## C. UI/UX & Branding (Web/App)

### C1. Login UI + security badges
- Files:
  - `packages/fork-ui/src/login.tsx`
  - `packages/fork-ui/src/two-factor.tsx`
  - `packages/fork-ui/src/two-factor-setup.tsx`
  - `packages/app/src/login/**` (thin wrappers + HTML entrypoints)
  - `packages/app/src/pages/**`
  - `packages/app/src/components/**`
- Behavior:
  - Login forms, 2FA flow, HTTP warning UI.

### C2. App UI changes
- Files:
  - `packages/fork-ui/src/auth-gate.tsx`
  - `packages/fork-ui/src/auth-error.ts`
  - `packages/fork-ui/src/session-indicator.tsx`
  - `packages/fork-ui/src/manage-2fa-dialog.tsx`
  - `packages/fork-ui/src/session-expired-overlay.tsx`
  - `packages/fork-ui/src/security-badge.tsx`
  - `packages/fork-ui/src/security-badge-style.ts`
  - `packages/fork-ui/src/http-warning-banner.tsx`
  - `packages/fork-ui/src/session-expiration-warning.ts`
  - `packages/fork-ui/src/csrf-fetch.ts`
  - `packages/fork-ui/src/use-clone-progress.ts`
  - `packages/app/src/components/**` (thin wrappers)
  - `packages/app/src/context/**`
  - `packages/app/src/pages/**`
- Behavior:
  - Session view tweaks, terminal UI changes, dialogs.

## D. Terminal & PTY Behavior

### D1. Broker-backed PTY
- Files:
  - `packages/opencode/src/pty/index.ts`
  - `packages/opencode/src/pty/broker-pty.ts` (wrapper)
  - `packages/fork-terminal/src/broker-pty.ts`
  - `packages/fork-terminal/src/broker-pty-manager.ts`
  - `packages/fork-terminal/src/server-pty.ts`
  - `packages/fork-terminal/src/pty-auth-hook.ts`
  - `packages/opencode/src/server/routes/pty.ts`
  - `packages/fork-terminal/src/server.ts`
- Behavior:
  - Broker PTY creation for authenticated sessions.

### D2. Terminal UI + addons
- Files:
  - `packages/fork-terminal/src/terminal.tsx`
  - `packages/fork-terminal/src/sortable-terminal-tab.tsx`
  - `packages/fork-terminal/src/serialize-addon.ts`
  - `packages/fork-terminal/src/terminal-types.ts`
  - `packages/app/src/components/terminal.tsx` (wrapper)
  - `packages/app/src/components/session/session-sortable-terminal-tab.tsx` (wrapper)
  - `packages/app/src/addons/serialize.ts` (re-export)
- Behavior:
  - Terminal rendering, tab drag/drop, and buffer serialization moved into fork package with thin app wrappers.

## E. Providers & Integrations

### E0. Upstream-only items (reference)
- MCP auth enhancements (upstream; no fork-specific changes detected)
- Scheduler/automation module (upstream; no fork-specific changes detected)

### E1. OpenRouter free model support (fork-only)
- Files:
  - `packages/fork-provider/src/openrouter.ts`
  - `packages/fork-provider/src/index.ts` (provider hooks)
  - `packages/opencode/src/provider/provider.ts` (hook usage)
  - `packages/opencode/src/config/config.ts` (OpenRouter config schema via fork-provider)
  - `packages/console/core/script/update-models.ts` (OpenRouter defaults/free model patching)
  - `packages/console/core/src/model.ts` (OpenRouter byok provider + headers schema)
  - `packages/console/app/src/routes/workspace/[id]/provider-section.tsx` (OpenRouter provider entry)
  - `packages/console/app/src/routes/zen/util/handler.ts` (OpenRouter custom headers passthrough)
- Behavior:
  - OpenRouter free router/variant augmentation and default selection in opencode runtime.
  - Console model-management support for OpenRouter defaults and custom header passthrough.

## F. Internationalization & UI Assets

### F0. Upstream-only items (reference)
- i18n + assets (upstream; no fork-specific changes detected).

## G. Docs & Operational Guidance

- `docs/pam-config.md` (PAM configuration)
- `docs/reverse-proxy.md` and `docs/reverse-proxy/*` (TLS/reverse proxy)
- `docs/docker-install-fork.md` (fork install guidance)
- `FORK.md` (fork-specific README notes)
- `README.md` (kept aligned to upstream with minimal fork edits)
- `packages/web/src/content/docs/{agents,cli,config,permissions}.mdx` (fork permission-default docs)

## H. Tests

- Fork auth/security/PTY/integration tests under `packages/fork-tests/**`
- Upstream test tree remains mostly clean; two fork tests were moved out of opencode test tree:
  - `packages/opencode/test/server/session-list.test.ts` (deleted, moved to fork-tests)
  - `packages/opencode/test/server/session-select.test.ts` (deleted, moved to fork-tests)

## I. Infra / CI / Workflows

- Workflows under `.github/workflows/**`
- Fork upstream sync automation: `.github/workflows/sync-upstream.yml`
- Fork sync orchestrator script: `script/sync-upstream.ts`
- Upstream mirror verification script: `script/verify-upstream-mirror.sh`
- Nix/flake updates: `flake.nix`, `flake.lock`, `nix/**`
- Containers: `packages/containers/**`

## J. Planning / Internal Docs
- `.planning/**` (fork-only)
- `specs/**` (upstream; no fork-specific changes detected)

## K. Repo & SSH Management

### K1. Repo clone and management routes
- Files:
  - `packages/fork-auth/src/routes/repo.ts`
  - `packages/opencode/src/server/routes/repo.ts` (re-export)
  - `packages/opencode/src/server/server.ts` (route wiring)
- Behavior:
  - Auth-aware repo cloning/branch management.

### K2. SSH key management routes
- Files:
  - `packages/fork-auth/src/routes/ssh-keys.ts`
  - `packages/opencode/src/server/routes/ssh-keys.ts` (re-export)
  - `packages/opencode/src/server/server.ts` (route wiring)
- Behavior:
  - Auth-aware SSH key CRUD endpoints.

## L. Repo Tooling / Fork Defaults

- `AGENTS.md` (fork alignment and workflow rules for contributors/agents)
- `.opencode/opencode.jsonc` (fork runtime defaults and policy)
- `.cursor/rules/*.mdc` (fork editor/agent policy defaults)
- Root metadata/config deltas: `.gitignore`, `package.json`, `bun.lock`, `tsconfig.json`

## Remaining Areas
- None (current decoupling checklist complete)

## Notes
- This is the restored post-catch-up inventory. Update this checklist whenever fork behavior ownership changes.
- Fork hook packages: `packages/fork-auth`, `packages/fork-ui`, `packages/fork-terminal`, `packages/fork-cli`, `packages/fork-security`, `packages/fork-provider`, `packages/fork-config`.
