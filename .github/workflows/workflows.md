# GitHub Actions Workflows

| File | What it does | Trigger |
|------|-------------|---------|
| `publish.yml` | Full release pipeline: bumps version, builds CLI (Linux/macOS/Windows), signs Windows binaries via Azure Trusted Signing, builds Electron desktop app for 6 platforms with Apple notarization, publishes to npm/GitHub Releases/AUR/GHCR | Push to `dev`, `beta`, `ci`, snapshot branches; `workflow_dispatch` with `major`/`minor`/`patch` bump input |
| `publish-vscode.yml` | Publishes the VS Code extension to the VS Code Marketplace and OpenVSX | Push of `vscode-v*.*.*` tag; `workflow_dispatch` |
| `publish-github-action.yml` | Publishes the GitHub Action (`./github/`) by running `./github/script/publish` | Push of `github-v*.*.*` tag; `workflow_dispatch` |
| `release-github-action.yml` | Runs `./github/script/release` to prepare a GitHub Action release | Push to `dev` that touches `github/**` |
| `deploy.yml` | Deploys the web app via `bun sst deploy` to AWS using OIDC, injecting per-environment Cloudflare/PlanetScale/Stripe/Sentry secrets | Push to `dev` or `production`; `workflow_dispatch` |
| `containers.yml` | Builds and pushes Docker container images to GHCR | Push to `dev` that touches `packages/containers/**`; `workflow_dispatch` |
| `test.yml` | Runs unit tests (via Turbo) and Playwright e2e tests on both Linux and Windows | Push to `dev`; any pull request; `workflow_dispatch` |
| `typecheck.yml` | Runs TypeScript typechecking (`bun typecheck`) | Push to `dev`; PRs targeting `dev`; `workflow_dispatch` |
| `storybook.yml` | Builds Storybook to catch UI component regressions | Push/PR to `dev` touching `packages/storybook/**` or `packages/ui/**`; `workflow_dispatch` |
| `nix-eval.yml` | Validates the Nix flake by evaluating all package derivations and devShells across 4 systems (x86_64/aarch64 × linux/darwin) | Push/PR to `dev`; `workflow_dispatch` |
| `nix-hashes.yml` | Recomputes SHA256 `node_modules` hashes for Nix reproducible builds on native runners for all 4 platforms, then commits updated `nix/hashes.json` | Push to `dev` or `beta` touching lockfiles or Nix config; `workflow_dispatch` |
| `generate.yml` | Runs `./script/generate.ts`: introspects the opencode HTTP server to produce `openapi.json`, generates a typed TypeScript SDK via `@hey-api/openapi-ts`, then auto-commits any changed artifacts as `chore: generate` | Push to `dev` |
| `beta.yml` | Runs `script/beta.ts` to sync the `beta` branch (cherry-pick/merge from `dev`) | Hourly cron (`0 * * * *`); `workflow_dispatch` |
| `opencode.yml` | Runs the opencode AI agent (Claude Opus 4.5) in response to `/oc` or `/opencode` slash commands in comments, with bash access denied | Issue comment or PR review comment created containing `/oc` or `/opencode` |
| `review.yml` | Runs opencode (GPT-5.5) to review a PR diff against the style guide and post inline GitHub code review comments | Issue comment starting with `/review`, posted by an OWNER or MEMBER |
| `triage.yml` | Runs `opencode run --agent triage` to automatically triage and label new issues | Issue opened |
| `docs-update.yml` | Every 12 hours, checks recent commits and uses opencode (GPT-5.2) to find undocumented new features and update `packages/web/src/content/docs/` | Cron every 12 hours (`0 */12 * * *`); `workflow_dispatch` |
| `docs-locale-sync.yml` | **Disabled** (`if: false`). Would sync localized docs using an opencode translator subagent when English `.mdx` files change | Push to `dev` touching `packages/web/src/content/docs/*.mdx` |
| `pr-standards.yml` | For external contributors: enforces conventional commit title format (`feat:`, `fix:`, etc.) and requires a linked issue; adds `needs:title` / `needs:issue` labels and posts guidance comments | PR opened, edited, or synchronized (`pull_request_target`) |
| `pr-management.yml` | Uses opencode to detect duplicate PRs and comment if found; adds a `contributor` label for CONTRIBUTOR-association authors | PR opened (`pull_request_target`) |
| `duplicate-issues.yml` | Uses opencode to check contributing-guideline compliance and find duplicate issues on new issues; rechecks compliance when a flagged issue is edited | Issue opened or edited |
| `compliance-close.yml` | Automatically closes issues and PRs that still have the `needs:compliance` label more than 2 hours after the compliance comment was posted | Cron every 30 minutes (`*/30 * * * *`); `workflow_dispatch` |
| `close-prs.yml` | Closes PRs older than 1 month with fewer than 2 positive reactions (configurable threshold, age, and dry-run mode) | Daily cron at 22:00 UTC; `workflow_dispatch` |
| `close-issues.yml` | Runs `script/github/close-issues.ts` to close stale issues | Daily cron at 02:00 UTC; `workflow_dispatch` |
| `notify-discord.yml` | Sends a formatted embed to a Discord channel via webhook when a release is published | GitHub release published |
| `stats.yml` | Runs `script/stats.ts` to fetch download metrics from PostHog and commits the updated `STATS.md` | Daily cron at 12:00 UTC; `workflow_dispatch` |
