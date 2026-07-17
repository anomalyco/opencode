# Fork Syncing & Custom Branching Strategy

To keep your fork of OpenCode in sync with the upstream repository while developing your own features, follow this workflow.

## Git Remotes Configuration

Set the original repository as your `upstream` remote:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
```

## Branch Strategy

- **`dev` branch:** Keep this clean. It should strictly track `upstream/dev`. Do not commit custom code directly to it.
- **Custom branches:** Create separate branches for your custom work.
  - **Rule:** Short kebab-case names of at most three words, separated by hyphens (e.g., `custom-feature-name`). Do not use slashes or prefixes like `feat/` or `fix/`.

## Manual Sync Workflow

1. Sync local `dev` with upstream:
   ```bash
   git checkout dev
   git pull upstream dev
   git push origin dev
   ```
2. Integrate into your custom branch:
   ```bash
   git checkout <your-custom-branch>
   git merge dev
   ```

---
> [!TIP]
> Use `make sync` to automate this workflow.

## Changelog

### 2026-07-17

- **Added [FORK.md](file:///Users/mmcdonnell/code/opencode/FORK.md):** Outlines branching, syncing, and custom workspace strategy.
- **Added [Makefile](file:///Users/mmcdonnell/code/opencode/Makefile):** Standard checkmake-compliant targets for building, cleaning, testing, and syncing with automatic Bun dependency management.
- **Updated `alias.zsh`:** Mapped global `oc` alias to local compiled standalone binary via `$HOME`.
