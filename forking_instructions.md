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

---

## How release binaries are built (for our forked releases)

### Key facts

- The CLI is compiled with **Bun's single-file compiler** (`Bun.build({ compile: { target } })`),
  which **cross-compiles every OS/arch from one Linux machine** — no per-OS build
  runners are needed for the CLI itself.
- The build script is `packages/opencode/script/build.ts`. It builds 12 targets:
  - **linux**: `arm64`, `x64`, `x64-baseline`, `arm64-musl`, `x64-musl`, `x64-baseline-musl`
  - **darwin (macOS)**: `arm64`, `x64`, `x64-baseline`
  - **windows**: `arm64`, `x64`, `x64-baseline`
  - "baseline" = no-AVX2 variant for older x64 CPUs; "musl" = Alpine-style libc.

> **What our deployment actually needs.** We only ship opencode inside the
> `vm-app` Docker sandbox (`backend/docker/services/opencode_sandbox/Dockerfile`),
> whose base image is **`python:3.12-slim-bookworm`** — Debian, **glibc**. So of the
> 12 targets, only the **glibc Linux** ones are relevant:
>
> | Deployment host | Target we need |
> | --- | --- |
> | x86-64 server / x64 CI runner (most cloud VMs) | `linux-x64` |
> | Apple-Silicon dev machine building the image locally | `linux-arm64` |
> | Old x86-64 CPU without AVX2 | `linux-x64-baseline` |
>
> **Skip the `*-musl` targets** — bookworm is glibc, not Alpine. **Skip darwin and
> windows** — nothing runs the CLI outside the Linux container. Because the sandbox
> Dockerfile has no `--platform` pin, the image builds for whatever arch Docker is
> running on, so keep **both `linux-x64` and `linux-arm64`** available (build x64 on
> a server, arm64 when building on Apple Silicon). See
> "Deploying the fork into the vm-app sandbox" below for how the image consumes them.
- Each target lands in `packages/opencode/dist/opencode-<os>-<arch>[-baseline][-musl]/bin/opencode`
  plus a per-platform npm `package.json` (with `os`/`cpu`/`libc` constraints).
- When releasing (`OPENCODE_RELEASE=true`), the script tars/zips each target
  (`.tar.gz` for linux, `.zip` for mac/windows) and uploads them to the GitHub
  release with `gh release upload v<version> ... --repo $GH_REPO`.
- Version/channel come from env vars consumed by `@opencode-ai/script`:
  `OPENCODE_VERSION` (the version string) and `OPENCODE_RELEASE` (set to publish).
- npm distribution (`packages/opencode/script/publish.ts`): each platform binary is
  its own npm package (e.g. `opencode-linux-x64`), and a meta package `opencode-ai`
  lists them all as `optionalDependencies` with a postinstall that picks the right one.
  It also builds a multi-arch Docker image and pushes AUR/Homebrew-style metadata —
  all hardcoded to `anomalyco/opencode`, so **skip or rewrite this for our fork**.

### CI pipeline (`.github/workflows/publish.yml`)

Runs on push to `dev`/`beta` or manual dispatch. Jobs, in order:

1. **version** — `script/version.ts` computes the version, creates a draft GitHub release.
2. **build-cli** — one Ubuntu runner runs `./packages/opencode/script/build.ts`,
   producing all platform binaries (this is the cross-compilation step).
3. **sign-cli-windows** — Windows runner signs the `.exe`s via Azure Trusted Signing,
   re-zips, uploads. *(Optional for us — unsigned exes work, just trigger SmartScreen.)*
4. **build-electron** — desktop app only; a 6-way matrix of real macOS/Windows/Linux
   runners with Apple/Azure code signing. *(Only needed if we ship the desktop app.)*
5. **publish** — `script/publish.ts` bumps versions, publishes npm packages, Docker,
   AUR, then finalizes the GitHub release. Note it **pushes a version-sync commit back
   to `dev`** — for our fork that would need to target `vm-main` instead.

Note the workflows are gated with `if: github.repository == 'anomalyco/opencode'`,
so they won't run on our fork until we change that guard (and the `GH_REPO` /
release-repo references) to `VMDevTeam/opencode-fork`.

### Building our own release binaries locally

```bash
bun install

# All 12 platform targets (cross-compiled from any machine):
OPENCODE_VERSION=1.0.0-vm ./packages/opencode/script/build.ts

# Just the current machine's platform (fast, for testing):
OPENCODE_VERSION=1.0.0-vm ./packages/opencode/script/build.ts --single

# Build AND upload archives to a GitHub release on our fork
# (release must already exist: gh release create v1.0.0-vm --repo VMDevTeam/opencode-fork)
OPENCODE_VERSION=1.0.0-vm OPENCODE_RELEASE=true GH_REPO=VMDevTeam/opencode-fork \
  ./packages/opencode/script/build.ts
```

Binaries end up in `packages/opencode/dist/`. The build embeds the web UI
(`packages/app` is built first; pass `--skip-embed-web-ui` to skip) and runs a
`--version` smoke test on the host-platform binary. Requirements: `bun`, `zip`,
`tar`, and `gh` (only for release upload).

---

## Deploying the fork into the vm-app sandbox

opencode only ever runs in **one** place in `vm-app`: the `sandbox` service, built
from `backend/docker/services/opencode_sandbox/Dockerfile` and wired up in the root
`docker-compose.yml`. Nothing else (backend, frontend, nginx, postgres, redis,
minio) touches the CLI. So "deploying our fork" means getting our forked binary
into that one image instead of the upstream one.

### What the sandbox image is today

- Base image: **`python:3.12-slim-bookworm`** → Debian **glibc** (not Alpine/musl),
  Node 20 installed on top.
- It currently installs **upstream** opencode with the vendored install script:
  ```dockerfile
  # RUN curl -fsSL https://opencode.ai/install | VERSION=1.14.40 bash  # pinned
  RUN curl -fsSL https://opencode.ai/install | bash
  ```
  then copies the binary to `/usr/local/bin/opencode` so every user can run it.
- The install script auto-detects OS/arch/libc, so on bookworm it pulls the
  `linux-<arch>` **glibc** build — matching the target table in the section above.
- There is no `--platform` pin, so the image is built for the Docker host's arch:
  `linux/arm64` on Apple-Silicon dev machines, `linux/x64` on typical x64 servers.

### Swapping in our forked binary

Pick one of these; the version pin (currently `v1.14.40`, held back because
`v1.14.48` broke the `/event` SSE stream) must be preserved either way.

**Option A — install from our GitHub release (mirrors current flow).**
If we publish fork releases to `VMDevTeam/opencode-fork` (see the release section
above), fetch the arch-appropriate glibc archive straight from the release instead
of `opencode.ai`. Replace the install `RUN` with something like:

```dockerfile
ARG OPENCODE_VERSION=1.14.40-vm
ARG TARGETARCH                       # provided by buildx: amd64 | arm64
RUN case "$TARGETARCH" in \
      amd64) OC_TARGET=linux-x64 ;; \
      arm64) OC_TARGET=linux-arm64 ;; \
      *) echo "unsupported arch: $TARGETARCH" && exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/opencode.tar.gz \
      "https://github.com/VMDevTeam/opencode-fork/releases/download/v${OPENCODE_VERSION}/opencode-${OC_TARGET}.tar.gz" \
 && tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin \
 && rm /tmp/opencode.tar.gz \
 && chmod 755 /usr/local/bin/opencode \
 && which opencode && opencode --version
```

(Only build the `linux-x64` and `linux-arm64` glibc targets for the release — the
`*-musl`, darwin, and windows targets are never used by this image.)

**Option B — COPY a locally-built binary (no release needed).**
Build just the host target with `./packages/opencode/script/build.ts --single`,
drop the resulting `packages/opencode/dist/opencode-linux-<arch>/bin/opencode` into
the `vm-app` build context, and `COPY` it in:

```dockerfile
COPY docker/services/opencode_sandbox/opencode /usr/local/bin/opencode
RUN chmod 755 /usr/local/bin/opencode && which opencode && opencode --version
```

Simple and offline, but the binary is arch-specific — the one you build must match
the arch you build the image on, and you can't cross-serve x64 and arm64 from the
same checked-in file. Prefer Option A once fork releases exist.

### Things to keep consistent

- **glibc, not musl.** Never grab a `*-musl` build for this image — it won't run on
  bookworm.
- **Keep the version pin.** Whatever mechanism you use, hold the version explicitly
  (env/ARG) so a bad upstream release can't slip in during a rebuild; bump it only
  after testing, exactly like the existing `VERSION=1.14.40` comment.
- **Per the vm-app CLAUDE.md, never rebuild or restart the sandbox container
  yourself** — change the Dockerfile only and let the user trigger the build.
- After changing how opencode is installed, smoke-test that the sandbox's OpenCode
  server still comes up on `54321` and the `/event` SSE stream stays open (that's
  the regression the pin guards against).
