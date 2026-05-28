# syntax=docker/dockerfile:1.7
#
# Multi-stage build optimised for fast iteration during development.
#
# Layer-cache strategy:
#   1. apt deps + plugin pre-install     → stable, change rarely → top of file
#   2. manifests-only COPY → bun install → cached unless package.json/lockfile changes
#   3. full source COPY → bun run build  → only this stage re-runs on source edits
#
# Typical iteration after a source edit: only stage 3 rebuilds.
# Cold build time: ~the same.  Warm rebuild after a source-only edit: ~minutes saved.

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — extract only the files `bun install` needs so the install layer is
# cached independently of source-code edits.
#
# We COPY the whole context (invalidates on any change) then strip everything
# except:
#   - package.json files (every workspace + root)
#   - bun.lock / bun.lockb
#   - patches/* — referenced by `patchedDependencies` in root package.json;
#                 bun install fails immediately if any patch file is missing
#   - .npmrc / .bunfig.toml — registry/auth config, if present
#
# The OUTPUT of this stage is content-addressed: if none of those files change,
# downstream COPY --from=manifests is a cache hit and `bun install` is skipped.
# ─────────────────────────────────────────────────────────────────────────────
FROM busybox AS manifests
WORKDIR /m
COPY . .
RUN find . -type f \
      ! -name 'package.json' \
      ! -name 'bun.lock' \
      ! -name 'bun.lockb' \
      ! -name '.npmrc' \
      ! -name 'bunfig.toml' \
      ! -path './patches/*' \
      -delete && \
    find . -type d -empty -delete


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — system deps + opencode plugin pre-install + workspace deps install.
# Anything in this stage is reused as long as manifests don't change.
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.3 AS deps
WORKDIR /app

# System packages — git for the workspace repo cloning at runtime; build tools
# in case native modules need to compile (tree-sitter / pty fall back to wasm
# when --ignore-scripts is used, but g++/python3/make are still cheap insurance);
# nodejs/npm are required by @npmcli/arborist (opencode's plugin loader);
# openssh-client lets git fork ssh for npm packages that declare git+ssh deps
# (pnpm-lock.yaml occasionally records ssh URLs from upstream package.json
# specs).  Without ssh in PATH, git fails with "cannot run ssh: No such file
# or directory" — observed in the wild during unleashlive/frontend preview
# install.  We don't actually USE ssh auth (no key shipped); the next layer
# rewrites every git ssh URL to authenticated HTTPS via a system gitconfig.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates python3 make g++ nodejs npm openssh-client && \
    rm -rf /var/lib/apt/lists/*

# Rewrite ssh-form GitHub URLs to HTTPS at the system level.  Every flavour
# pnpm / npm / yarn could produce gets normalised to `https://github.com/`:
#
#   git@github.com:owner/repo        → https://github.com/owner/repo
#   ssh://git@github.com/owner/repo  → https://github.com/owner/repo
#   git+ssh://git@github.com/...     → https://github.com/...
#
# Public repos clone unauthenticated; for private repos (e.g. unleashlive
# internal forks declared as deps in the frontend's package.json) the
# per-launch GIT_ASKPASS handler below supplies the Driver's OAuth token at
# git's credential prompt.  Writing to /etc/gitconfig (--system) means the
# rule applies to every UID inside the container — preview launches run as
# uid 10001, not root, so --global wouldn't reach the right HOME.
RUN git config --system url."https://github.com/".insteadOf "git@github.com:" && \
    git config --system url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --system url."https://github.com/".insteadOf "git+ssh://git@github.com/"

# Credential helper for authenticated HTTPS git fetches.  When git needs
# creds (e.g. cloning a private dep over the URL the rewrite above produced),
# it execs $GIT_ASKPASS twice — once for "Username", once for "Password".
# Our helper answers `x-access-token` / `$GITHUB_TOKEN`, which is GitHub's
# canonical OAuth-app HTTP basic-auth form.
#
# Token-flow lifecycle:
#   - Token NEVER lands on disk (only in env at install time)
#   - Token NEVER lands in pnpm-lock.yaml (lockfile sees `https://github.com/`
#     from the rewrite above — the askpass form keeps the URL clean)
#   - The preview-launcher injects GITHUB_TOKEN per-spawn only.  Outside the
#     install process, GITHUB_TOKEN is unset.
#
# Bun's shell-builtin /usr/local/bin needs to be writable by uid 10001 (or
# the file world-readable) — we chmod a+rx + write as root, world-readable.
RUN printf '#!/bin/sh\ncase "$1" in\n  Username*) echo x-access-token ;;\n  Password*) echo "$GITHUB_TOKEN" ;;\nesac\n' \
      > /usr/local/bin/git-askpass-token && \
    chmod a+rx /usr/local/bin/git-askpass-token
ENV GIT_ASKPASS=/usr/local/bin/git-askpass-token

# pnpm@10 — used by the frontend live-preview launcher to install + run dev
# servers inside a collab workspace (see packages/opencode/src/collab/preview-launcher.ts).
# Pre-installed here so the first "Launch" click doesn't pay the ~10s
# `npx pnpm@10` cold-start every time.  Bound to a specific major to match
# unleashlive/frontend's lockfile.
RUN npm install --global pnpm@10 2>&1 | tail -3 && pnpm --version

# Pre-install opencode-claude-auth into opencode's npm package cache.
# Lives at /root/.cache/opencode/packages/<sanitized-pkg>/node_modules/<name>.
# At runtime, @opencode-ai/core/npm.ts checks `existsSafe(...)` and short-circuits,
# avoiding an ~18 s arborist.reify() that would otherwise block the event loop
# the first time a collab session is created.
#
# Cache mount on /root/.npm keeps the npm download cache between builds so this
# step is ~instant on subsequent builds (uses cached tarballs).
RUN --mount=type=cache,target=/root/.npm \
    PLUGIN_CACHE=/root/.cache/opencode/packages/opencode-claude-auth@latest && \
    mkdir -p "$PLUGIN_CACHE" && \
    printf '{"name":"opencode-plugin-cache","version":"1.0.0","private":true,"dependencies":{"opencode-claude-auth":"latest"}}\n' \
      > "$PLUGIN_CACHE/package.json" && \
    npm install --prefix "$PLUGIN_CACHE" --ignore-scripts --no-audit --no-fund 2>&1 | tail -3 && \
    echo "opencode-claude-auth pre-install complete" || \
    echo "WARNING: opencode-claude-auth pre-install failed; will install lazily at runtime"

# Pre-create directories that opencode and the collab workspace need at runtime.
# Paths live under /home/opencode (ADR-0003) — the opencode user owns them and
# they're created here so the final-stage chown is one shallow walk.
RUN mkdir -p /var/opencode/workspaces \
             /home/opencode/.local/share/opencode \
             /home/opencode/.config/opencode \
             /home/opencode/.cache/opencode/packages \
             /home/opencode/.claude && \
    # Bake a container-wide opencode config:
    #   - `plugin`: pre-installed opencode-claude-auth (cached above at /root)
    #   - `disabled_providers`: amazon-bedrock is disabled for this fork.
    #     ap-southeast-2 (utils deployment) only offers LEGACY Claude 3 / 3.5
    #     Sonnet v2 as ON_DEMAND models; the modern Claude 4.x family is
    #     INFERENCE_PROFILE-only via `apac.*` cross-region profiles, and
    #     opencode's bedrock region-prefix logic
    #     (packages/opencode/src/provider/provider.ts:1747-1759) only handles
    #     `us.*` / `eu.*` prefixes — `ap-*` falls back to whatever the sort
    #     puts first, which lands on `us.anthropic.claude-sonnet-4-6`.  That
    #     ID does not exist in ap-southeast-2 → Bedrock returns 400 "The
    #     provided model identifier is invalid" on every request.
    #     Disabling the provider removes the variant from the dropdown so
    #     users can only pick Anthropic-native models (auth'd via the
    #     opencode-claude-auth plugin).
    printf '{"plugin":["opencode-claude-auth@latest"],"disabled_providers":["amazon-bedrock"]}\n' \
      > /home/opencode/.config/opencode/opencode.json && \
    # Carry the pre-installed plugin tree across from /root.
    cp -r /root/.cache/opencode/packages/. /home/opencode/.cache/opencode/packages/ 2>/dev/null || true

# Bring in ONLY manifests, then install workspace deps.
# Cache mount on /root/.bun/install/cache keeps the bun package store between builds.
COPY --from=manifests /m/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --no-optional --ignore-scripts


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — build the SolidJS web app.  Only this stage re-runs on source edits.
# Inherits node_modules + all caches from the `deps` stage.
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

# Copy the full source.  This invalidates on every source change — that's fine,
# because the expensive `bun install` above is already done.
COPY . .

# Build the web app (Vite + SolidJS).  Cache mount keeps Vite's dep optimizer
# warm between builds — ~10–20 s saved on subsequent builds.
RUN --mount=type=cache,target=/app/packages/app/node_modules/.vite \
    bun run --cwd packages/app build

# Container entrypoint — writes ~/.claude/.credentials.json from
# $CLAUDE_CREDENTIALS_JSON when present, then execs the server.  See
# scripts/entrypoint.sh for the rationale.
COPY scripts/entrypoint.sh /usr/local/bin/opencode-entrypoint
RUN chmod +x /usr/local/bin/opencode-entrypoint

# ─────────────────────────────────────────────────────────────────────────────
# Non-root user (ADR-0003).
#
# Until this stage everything ran as root for build speed.  Now we create the
# `opencode` user (uid 10001) and hand the runtime tree over to it.  The
# container's working set after this point — /app, /home/opencode, and the
# data mount at /var/opencode — is owned by uid 10001.  Drops the
# blast-radius of any future RCE / PTY abuse from "read every secret" to
# "stuff the unprivileged user can see".
# ─────────────────────────────────────────────────────────────────────────────
RUN useradd --uid 10001 --create-home --shell /bin/bash --home-dir /home/opencode opencode 2>/dev/null || true && \
    chown -R 10001:10001 /app /home/opencode /var/opencode /usr/local/bin/opencode-entrypoint

ENV NODE_ENV=production
ENV HOME=/home/opencode
EXPOSE 4096

USER opencode

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint"]
