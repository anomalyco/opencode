# E2E tests

Playwright drives the app; **`packages/app/script/e2e-local.ts`** starts everything else.

## Infrastructure

`test:e2e:local` / `test:e2e:local-univer` provision dependencies automatically:

- **Postgres** + **Ollama** (when `ollama` is in `OPENCODE_E2E_INFRA`) via **Testcontainers** — `script/e2e-testcontainers.ts`.
- **MinIO + univer-compat** when `univer` is in infra — `script/e2e-testcontainers.ts` (`startUniverE2e`).
- **OpenCode API** runs **in-process** (not containerized).

**Requirements:** Docker daemon running (Desktop or Linux). First cold run pulls images and the `llama3.2:1b` model inside Ollama — often several minutes.

## Running

From **repo root** (recommended):

```bash
bun run test:e2e:local
bun run test:e2e:local-univer
bun run test:e2e:infra-smoke
```

Same scripts exist under **`packages/app`** if you `cd` there.

```bash
# Full Playwright + OpenCode + infra
bun run test:e2e:local

# Postgres + MinIO + compat + Univer layers (no default `ollama` — set layers if you need it)
bun run test:e2e:local-univer

# Extra args go to Playwright after --
bun run test:e2e:local -- e2e/integration/foo.spec.ts
```

## Prove Testcontainers without Playwright

Useful in CI or when you only want to see Docker layers come up:

```bash
bun run test:e2e:infra-smoke
```

Uses the same `OPENCODE_E2E_INFRA` as `e2e-local` (default `postgres,ollama`). Prints Postgres / Ollama / compat URLs, then stops containers.

**Faster check** (Postgres only, no Ollama pull):

```bash
OPENCODE_E2E_INFRA=postgres bun run test:e2e:infra-smoke
```

**Univer stack smoke** (includes MinIO + compat):

```bash
OPENCODE_E2E_INFRA=postgres,univer bun run test:e2e:infra-smoke
```

## Troubleshooting

- **Docker not reachable**: Testcontainers fails — start Docker Desktop / `docker info`.
- **Slow first run**: Normal — large images (`ollama/ollama`) and model download.
- Optional manual Compose (fixed ports): `./script/setup-e2e.sh` — only for debugging outside Testcontainers.
