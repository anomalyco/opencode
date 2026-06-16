# Maintaining the opencode fork

This repo is a fork of [`anomalyco/opencode`](https://github.com/anomalyco/opencode).
This doc explains how the fork is laid out and how to keep it current with upstream.

## Mental model

| Name | Where | Role |
| --- | --- | --- |
| `upstream` | `anomalyco/opencode` | The real opencode repo. We only ever **read** from it. |
| `origin` | `VMDevTeam/opencode-fork` | Our fork. We push here. |
| `dev` | upstream's default branch | opencode's "main". New work and releases land here. |
| `vm-main` | our branch on `origin` | **Our internal main.** This is the branch we treat as the source of truth. |
| `feature/*` | branched off `vm-main` | Where we do our own dev work. |

The workflow has two independent loops:

1. **Dev loop** — branch off `vm-main`, do work, open a PR back into `vm-main`.
2. **Sync loop** — every so often upstream ships a release; we pull `upstream/dev`
   into `vm-main` so our fork stays current.

## One-time setup (only needed on a fresh clone)

The remotes are already configured in existing checkouts. On a brand-new clone you'd run:

```bash
git clone https://github.com/VMDevTeam/opencode-fork.git
cd opencode-fork
git remote add upstream https://github.com/anomalyco/opencode.git
git remote set-url --push upstream DISABLE   # safety: never push to upstream by accident
```

Verify with `git remote -v`. You should see `origin` pointing at our fork and
`upstream` at `anomalyco/opencode`.

> Note: this repo also has a local `dev` branch tracking `origin/dev`. It's just a
> mirror of upstream's `dev` and is **not** where our work goes — ignore it for
> day-to-day work and treat `vm-main` as main.

---

## Dev loop: doing our own work

Always branch off the latest `vm-main`.

```bash
git checkout vm-main
git pull origin vm-main          # make sure local vm-main is current

git checkout -b feature/my-thing # create your work branch
# ... make changes, commit ...
git push -u origin feature/my-thing
```

Then open a PR on GitHub **into `vm-main`** (not `dev`, and never into upstream).
Review, merge, delete the branch. That's the whole inner loop.

Keep a feature branch fresh while you work on it:

```bash
git checkout feature/my-thing
git fetch origin
git rebase origin/vm-main        # rebase is fine on YOUR un-shared branch
```

Rule of thumb: **rebase your own feature branches, but never rebase `vm-main`** —
it's shared and pushed, so we always *merge* into it (see below).

---

## Sync loop: pulling in a new upstream release

Do this when opencode ships a release you want (or periodically to reduce drift).
The idea: fetch upstream, merge `upstream/dev` into `vm-main`, resolve any
conflicts, test, and push.

### 1. Fetch everything from upstream

```bash
git fetch upstream --tags
```

Check what's new:

```bash
git log --oneline vm-main..upstream/dev | head -50   # commits we don't have yet
git tag --sort=-creatordate | head                   # latest release tags (e.g. v1.4.11)
```

### 2. Do the sync on a throwaway branch first

Never merge straight into `vm-main`. Make an integration branch so a messy merge
can be thrown away without touching our main:

```bash
git checkout vm-main
git pull origin vm-main                # start from current internal main
git checkout -b sync/upstream-YYYY-MM-DD
```

### 3. Merge upstream

You have two choices for *what* to merge:

- **Track the dev tip** (simplest, stays closest to upstream):
  ```bash
  git merge upstream/dev
  ```
- **Pin to a specific release tag** (more controlled — recommended if you want to
  land known-good releases rather than the bleeding edge):
  ```bash
  git merge v1.4.11        # whatever the target release tag is
  ```

### 4. Resolve conflicts

Conflicts show up where our changes and upstream's overlap. For each:

```bash
git status                       # list conflicted files
# edit files to resolve, keeping BOTH our intent and upstream's where possible
git add <file>
```

Tips:
- `git checkout --theirs <file>` takes upstream's version wholesale; `--ours` keeps
  ours. Use only when you're sure one side fully wins.
- Conflicts in generated/lock files (`bun.lock`, `flake.lock`, `STATS.md`,
  `packages/**` generated output) are usually best resolved by taking upstream's
  version and then regenerating — don't hand-merge them.

Finish the merge:

```bash
git commit                       # completes the merge commit
```

### 5. Build and test before trusting it

```bash
bun install
bun run typecheck                # or the repo's check script
bun test
```

Smoke-test the actual app if the merge was large.

### 6. Fold the sync into vm-main

Once the integration branch is green, push it and open a PR into `vm-main`
(preferred — keeps the sync reviewable), **or** for a clean merge fast-forward it
directly:

```bash
# Option A — reviewable (preferred for big releases)
git push -u origin sync/upstream-YYYY-MM-DD
# open PR: sync/upstream-YYYY-MM-DD  ->  vm-main

# Option B — direct (fine for small/clean syncs)
git checkout vm-main
git merge --no-ff sync/upstream-YYYY-MM-DD
git push origin vm-main
```

Delete the integration branch when done.

### 7. (Optional) keep the local `dev` mirror current

If you want the local `dev` branch to keep mirroring upstream:

```bash
git checkout dev
git merge --ff-only upstream/dev
git push origin dev
git checkout vm-main
```

---

## Quick reference

```bash
# See how far behind upstream we are
git fetch upstream
git log --oneline vm-main..upstream/dev | wc -l

# Start a feature
git checkout vm-main && git pull && git checkout -b feature/x

# Sync a release
git fetch upstream --tags
git checkout vm-main && git pull
git checkout -b sync/upstream-$(date +%F)
git merge upstream/dev        # or a specific tag like v1.4.11
# resolve, test, then PR/merge into vm-main
```

## Rules to remember

- `vm-main` is sacred: only ever **merge** into it, never rebase or force-push.
- All our work branches off `vm-main` and PRs back into `vm-main`.
- We only ever **read** from `upstream`. Never push to it.
- Always sync on a throwaway `sync/*` branch first; merge into `vm-main` only after
  it builds and tests pass.
- Prefer merging release **tags** over the raw `dev` tip when you want stability.
