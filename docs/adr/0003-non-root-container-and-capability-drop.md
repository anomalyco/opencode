# ADR-0003: Run the container as a non-root user with dropped capabilities

- Status: Accepted
- Date: 2026-05-21
- Implemented: 2026-05-22 in commit `d3f413e87` on branch
  `deploy/auth-fix`.  EFS chown migration documented in DEPLOYMENT.md
  Step 5 (one-time aws ecs run-task with --overrides chown command).

## Context

The current `Dockerfile` does not set a `USER` directive — every process runs
as **root**.  This is observable from:

- `Dockerfile:65-76` placing caches and config under `/root/…`.
- `docker-compose.yml:41` mounting the data volume at `/root/.local/share/opencode`.
- No `USER` line anywhere in `Dockerfile`.

The collab feature gives any participant a PTY-backed terminal inside the
container (`packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts`).
Combined with root-uid execution this means a participant can:

- `env` to read `GITHUB_TOKEN`, `GITHUB_OAUTH_CLIENT_SECRET`, `SESSION_SECRET`,
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (all set as container env per
  `docker-compose.yml:9-37` and the documented ECS task definition).
- `cat /root/.local/share/opencode/*.sqlite*` to read **every other user's**
  `github_access_token`, stored plaintext in `collab_auth_session.github_access_token`
  (`packages/opencode/src/collab/schema.sql.ts:127-135`).
- `cat /var/opencode/workspaces/*/.git/config` to read the server PAT for
  every session (see ADR-0005).
- `cat /root/.claude/.credentials.json` when the Claude-Code-credential path is
  in use.

There is no per-session filesystem namespace, no seccomp, and no capability
drop.

## Decision

Add a non-root user to the image and bind every runtime process to it:

```Dockerfile
RUN useradd --uid 10001 --create-home --shell /bin/bash opencode
USER opencode
WORKDIR /home/opencode/app
```

Move runtime data paths off `/root`:

- `HOME=/home/opencode`
- SQLite data: `/home/opencode/.local/share/opencode`
- Workspaces: `/var/opencode/workspaces` (already separate; chown to `opencode`)
- Caches: `/home/opencode/.cache/opencode`

In the ECS task definition (`DEPLOYMENT.md` Step 5):

- Set `readonlyRootFilesystem: true` and grant write access only to the EFS
  mount paths plus an explicit `tmpfs` for `/tmp/opencode`.
- Add `linuxParameters.capabilities.drop: ["ALL"]`.
- Confirm Fargate's default no-new-privileges flag stays on.

Secrets that the container does not need to read after startup (the OAuth
client secret, the `SESSION_SECRET`) are kept as env vars only as long as
needed — the long-term direction is loading them once at boot and unsetting
them from `process.env` before any participant code can run.

## Consequences

**Positive**

- A PTY user can no longer read `/root/...` or other users' SQLite rows
  outside the opencode-user-readable subset.
- Capability drop blocks the most common container escape primitives.
- Read-only root filesystem stops in-container malware from persisting.

**Negative**

- Some opencode tooling assumes write access to its working directory.  Any
  path that currently lands in `process.cwd()` (`workspace-routing.ts:72`,
  `location.ts:43`) must move to an explicit writable mount or to the per-user
  data dir.
- `apt-get install` at runtime (used by some LSP fetchers in
  `packages/opencode/src/lsp/server.ts`) will fail; LSPs must be either
  pre-installed in the image or downloaded to `$HOME/.cache/opencode/bin`.
- One-time migration headache: the EFS data volume currently has files owned
  by uid 0.  Either run a chown step or use an EFS access point with uid 10001.

## Alternatives considered

- **Per-session container** (one Docker container per collab session) — the
  cleanest isolation story.  Rejected for v2 because it requires a substantial
  re-architecture (orchestrator, image registry usage, session lifecycle
  changes) and a significant cost increase.  Keep this as a future option.
- **gVisor / Firecracker sandbox under each PTY** — rejected for the same
  reason: too large a change to land alongside the deployment work.
- **Accept the risk because the user pool is `unleashlive` org members** —
  rejected because (a) ADR-0005 is needed regardless, and PAT-in-clone-URL is
  invisible to the user, and (b) compromising any single member's GitHub
  account compromises every credential the container holds.
