# E2E tests

Playwright drives the app; **`vitest.e2e.config.ts`** runs the browser suite (`test/browser/**/*.test.ts`). Each spec’s **`useE2eStack()`** hook starts **Postgres + MinIO + univer-compat** (Testcontainers), the **OpenCode** API container, **Vite**, and patches `process.env` for Playwright. **Ollama** must run on the **host** (`llama3.2:1b` at `http://127.0.0.1:11434`); the OpenCode container reaches it via `host.docker.internal`.

**Requirements:** Docker running; **WorkOS** + **COOKIE_PASSWORD** in `.env.development` / `.env.e2e` (see `assert-univer-workos-env.ts`). First cold run pulls images — often several minutes.

### Docker context (macOS / Colima)

Vitest **`setupFiles`** runs `test/support/tc-wire-setup.ts` → `wire-docker-context-for-tc.ts`: when `DOCKER_HOST` is unset, it follows the active **`docker context`** so Node/Testcontainers use the same daemon as the CLI. For Colima, `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` uses the in-VM `/var/run/docker.sock` for Ryuk mounts ([Testcontainers configuration](https://node.testcontainers.org/configuration)). Skip wiring: `OPENCODE_SKIP_DOCKER_CONTEXT_WIRE=1`.

**Reuse:** pass **`useE2eStack({ reuse: true })`** (default) for `.withReuse()` and stable network `opencode-e2e-bridge`; **`{ reuse: false }`** for an isolated run. The hook toggles `TESTCONTAINERS_REUSE_ENABLE` for the file only.

**Verbose stderr:** `OPENCODE_E2E_LOG=1`.

## Scripts (`packages/app`)

| Script | Purpose |
|--------|---------|
| `bun run test` | Unit tests (`./src`) |
| `bun run test:integration` | Vitest integration |
| `bun run test:browser` | Browser Vitest only (expects stack already up **or** specs that self-provision via hooks) |
| `bun run e2e` | Loads `.env.development` + `.env.e2e`, asserts WorkOS in `vitest.e2e.config.ts`, runs Vitest with `vitest.e2e.config.ts` (full browser suite by `include`) |
| `bun run playwright:install` | Install Chromium for Playwright |

From **repo root**: `bun run app:e2e`, `bun run app:playwright`.

**Subset / grep:** `bun run e2e -- test/browser/integration/foo.test.ts` or Vitest flags after `--`.

**Pyodide ↔ Univer bridge:** `bun run e2e -- test/browser/integration/pyodide-univer-bridge.test.ts` — real `veritly_univer_sdk` in Pyodide against `window.__veritlyUniverBridge` (spreadsheet must load in the same tab).

**Infra smoke** (start Postgres + Univer stack then stop, no app): `bun run test:browser -- test/browser/infra/infra-smoke.test.ts` (with the same env files as `e2e` if WorkOS vars are not already exported).

## Troubleshooting

- **`docker info`** / **`docker context`** — daemon must match what you expect (Colima: `colima start`, `docker context use colima`).
- **Slow first run** — image pulls and MinIO/compat startup are normal.
