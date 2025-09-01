Adds an optional Docker-backed server mode for the TUI and headless server to isolate the runtime environment without sacrificing TUI performance.

Why
- Improve security/isolation by running the server in a container
- Avoid host tooling/version conflicts while keeping the TUI native on the host
- Keep this fully optional; default behavior is unchanged

What
- TUI/Serve: `--docker` flag to start the server in Docker, mounting `$PWD` to `/workspace` and mapping a host port to container `8080`.
- Image: default to `opencodeai/opencode:server`; support `--docker-image`.
- Local builds: support `--dockerfile`, `--docker-context`, `--docker-build` for building a local image; added `script/docker-build` and `docker:build` script.
- Auth: sync only opencode-managed provider credentials to the server (`PUT /auth/:id`) and inject only provider-defined env vars (from models.dev) into the container (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). No $HOME/XDG dirs are mounted.
- Dockerfile: based on `oven/bun`; installs minimal tools (`git`, `curl`, `unzip`, `tar`, `nodejs`, `npm`, `golang`) and runs `bun run /app/src/index.ts serve --hostname 0.0.0.0 --port 8080`.
- CI: GitHub Action to publish `opencodeai/opencode:server` on release (multi-arch).
- Docs: README snippet for Docker usage.

Usage
- TUI: `opencode --docker` (uses Hub image) or `opencode --docker --docker-image opencode:local` after a local build
- Serve: `opencode serve --docker --port 8080`
- Build: `bun run docker:build` (tags both `opencodeai/opencode:server` and `opencode:local`)

Notes
- Backwards-compatible and opt-in.
- Only provider credentials are synced; no other host secrets are exposed.
