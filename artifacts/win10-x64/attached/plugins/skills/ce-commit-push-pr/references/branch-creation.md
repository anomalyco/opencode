# Branch creation from default branch

When Step 4 fires on the default branch, the local `<base>` (e.g., local `main`) is untrustworthy as a starting point. Two failure modes drive this:

- **Stale-base contamination.** Another agent session, worktree, or background process may have advanced local `<base>` past `origin/<base>` with commits unrelated to this work. Branching from local HEAD would carry those into the new feature branch and the eventual PR.
- **Forgot-to-branch.** The user authored real commits on local `<base>` intending them for a feature branch. Branching from `origin/<base>` would silently drop them.

Local git state alone cannot distinguish these two — the unpushed commits look identical. Author email is unreliable in multi-session setups where every session shares `user.email`. The skill therefore surfaces the choice to the user when unpushed commits are present.

## Decision flow

Run the steps in order. Each step's outcome determines whether the next runs.

### 1. Fetch fresh remote base

```bash
git fetch --no-tags origin <base>
```

- **Fetch succeeds:** continue to step 2.
- **Fetch fails:** skip to the bottom of this file, "Fetch failure fallback".

### 2. Check for unpushed local commits on `<base>`

```bash
git log origin/<base>..HEAD --oneline
```

- **Empty output:** no unpushed commits — proceed to step 3 with `BASE_REF=origin/<base>`.
- **Non-empty output:** unpushed commits exist on local `<base>`. Show the user the commit list and ask (per the platform's blocking question tool — see the "Asking the user" convention at the top of `SKILL.md`):

  > "Local `<base>` has N unpushed commits not on `origin/<base>`. Carry them onto the new feature branch, or leave them on local `<base>`?"

  Two options:
  - **Carry forward** (intent: "I forgot to branch first") — set `BASE_REF=HEAD`. The new branch starts from current local HEAD, preserving the commits.
  - **Leave on `<base>`** (intent: "stale-base contamination from another session") — set `BASE_REF=origin/<base>`. The new branch starts clean; the commits remain on local `<base>` for the user to handle separately.

  If the blocking tool is unavailable and you must fall back to chat, default to **leaving on `<base>`** only after the user replies — never silently. Carrying foreign commits into a PR is a worse failure than asking again.

### 3. Create the feature branch

```bash
git checkout -b <branch-name> "$BASE_REF"
```

- **Checkout succeeds:** branch created, continue to Step 4.2 in `SKILL.md`.
- **Checkout fails because uncommitted changes would be overwritten:** local `<base>` diverges from `origin/<base>` in files the user has also edited. Stash, retry, pop:

  ```bash
  git stash push -u -m "ce-commit-push-pr: pre-branch <branch-name>"
  git checkout -b <branch-name> "$BASE_REF"
  git stash pop
  ```

  If `git stash pop` reports conflicts (rare same-files case), surface the conflict output and the stash ref to the user so they can resolve manually. Do not attempt to auto-resolve.

  Note: this stash-retry-pop applies whether `BASE_REF` is `HEAD` or `origin/<base>`. In the `HEAD` case the overwrite collision is unlikely (the index was already at HEAD), but the same recovery sequence is safe to run.

## Fetch failure fallback

If `git fetch --no-tags origin <base>` fails (network, auth, no remote), the skill cannot verify base freshness or detect unpushed commits remotely. Fall back to:

```bash
git checkout -b <branch-name>
```

This branches from current local HEAD. Note in the user-facing summary that base freshness was not verified. Do not attempt the unpushed-commits check — without a fresh `origin/<base>`, the answer is unreliable.
