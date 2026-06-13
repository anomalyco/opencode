# Cedric

Cedric is a desktop coding workspace built from the OpenCode foundation and shaped for Kimi-first development. The current work focuses on a multi-tab desktop shell, Kimi provider integration, browser/computer-use tools, and a cleaner Cedric product identity.

## Current Focus

- Dynamic workspace tabs for review, browser, file, terminal, and side-chat surfaces
- First-class Kimi/Moonshot provider wiring
- In-app browser automation and computer-control experiments
- Desktop packaging under the Cedric app identity
- Continued compatibility with the OpenCode-derived core, SDK, and server layers

## Quick Start

```bash
bun install
bun run dev:desktop
```

For local UI work, run the backend and app separately:

```bash
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

cd ../app
bun dev -- --port 4444
```

Open `http://localhost:4444` for the local app UI.

## Validation

Run checks from package directories. The root `test` script is intentionally guarded.

```bash
cd packages/app
bun typecheck
bun test
bun run build

cd ../desktop
bun typecheck
bun run build
```

## Kimi Setup

Cedric can use Kimi through the Moonshot/OpenAI-compatible provider path. Some local workflows also use a Kimi ACP bridge; see `KIMI_SETUP.md`, `KIMI_SETUP_MOONSHOT_API.md`, and `OPENKIMI_LOCAL_SERVER_HANDOFF.md` before changing authentication or desktop startup behavior.

## Repository Notes

- Default branch: `dev`
- Root package scripts are orchestration helpers; package-level checks are preferred
- Some internal package names and config paths still use `opencode` because the core server and SDK layers are OpenCode-derived
- Desktop startup issues that show `Could not reach Local Server` are usually about the embedded sidecar health/auth path, not the Kimi bridge

## License

MIT
