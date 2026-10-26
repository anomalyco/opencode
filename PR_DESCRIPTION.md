### Issue for this PR

Closes #

### Type of change

- [ ] Bug fix
- [x] New feature
- [x] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

Ports the GitHub integration (`opencode github install` and `opencode github run`) from v1 to v2.

- Adds `opencode github` CLI command with `install` and `run` subcommands.
- `github install` interactively prompts for a model (any provider) and generates `.github/workflows/opencode.yml`, including the appropriate provider API key secret (supports `OPENCODE_API_KEY`).
- `github run` resolves a standalone/shared server, runs a prompt via the v2 non-interactive runner, performs permission checks and reactions, supports mock events (`--event`/`--token`), handles fork PRs, schedule/workflow_dispatch routing, and opens a PR when the working tree changes.
- Adds `@octokit/rest`, `@actions/github`, `@actions/core` to `packages/cli`.

### How did you verify your code works?

- `bun run typecheck:tsc` passes in `packages/cli`.
- End-to-end tested on `zzz-creator/audio-troubleshooting-lab`:
  - **Issue flow** (issue #4): `/oc summarize this repository` → model responded with a full summary of the repo.
  - **PR flow** (PR #5): `/oc summarize this PR` → model responded with a PR summary.

#### Proof of /oc Command

**Issue Flow (audio-troubleshooting-lab#4):**

Bot Response:
```
### Audio Troubleshooting Lab

An interactive browser-based mixing console training and troubleshooting simulator for Audio University.

#### Key Highlights
- **Tech Stack & Architecture:** Zero-build single-page app (React + Babel via CDN, deployed on GitHub Pages). Audio is procedurally synthesized from state using the Web Audio API rather than relying on external audio files.
- **Core Files:**
  - `index.html`: Single-page app engine, mixing console UI, Web Audio synthesis, and member unlock handling.
  - `content.js`: Scenario catalog containing definitions, fault pools, lessons (`START_HERE`, `LEVELS`, `PRACTICE`), and the authoritative `GLOSSARY`.
  - `js/unlock.js`: Client-side signed-cookie member access and unlock module.
  - `scripts/`: Verification and release toolchain (`promote.js`, `check_syntax.js`, `check_tier_prompt.js`, `check_lesson3_regression.js`, `lint_copy.py`).
- **Tier Model:** Free Essentials arc (acts as an educational lead magnet) alongside a Member tier that unlocks extended challenges, Practice Mode, Run the Show, and a feedback ring-out trainer via query-parameter gating (`?tier=member`, `?optedin=1`).
```

**PR Flow (audio-troubleshooting-lab#5):**

Bot Response:
```
### PR Summary

- **Type:** Test / Verification
- **Changes:**
  - Added `test-file.txt` containing a single line (`test content`).
- **Impact:** None on project functionality; created to test the `/oc` GitHub Action workflow on pull requests.
```

### Screenshots / recordings

N/A

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
