# Architecture Map

## System Shape

- Type: FULLSTACK
- Frontend: not detected
- Backend: not detected
- Database: PostgreSQL
- Jobs/workers: detected in repository text
- External integrations: GitHub, Stripe, OpenAI, Playwright, Sentry, PostgreSQL

## Local URLs

| Service | URL | Notes |
|---|---|---|
| Frontend | http://localhost:3000 | generated default for detected web stack |

## Request Path

```text
Maintainer or AI agent -> project manifest/docs -> runtime entrypoint -> validation commands -> evidence
```

## Key Directories

- `github` — top-level area detected during bootstrap
- `infra` — top-level area detected during bootstrap
- `nix` — top-level area detected during bootstrap
- `packages` — top-level area detected during bootstrap
- `patches` — top-level area detected during bootstrap
- `perf` — top-level area detected during bootstrap
- `script` — top-level area detected during bootstrap
- `sdks` — top-level area detected during bootstrap
- `specs` — top-level area detected during bootstrap

## Authentication

- Flow: NextAuth/Auth.js session flow
- Local/demo credentials: not documented
- Token/session storage: not detected
- Common failure mode: missing local environment variables or auth provider configuration

## Observability

- App logs: stdout / terminal output
- API logs: stdout when backend is present
- Job logs: not detected
- Request correlation: not detected

## Deployment

- Environments: local plus CI-managed environments if configured
- CI/CD: GitHub Actions when present under .github/workflows
- Release notes/changelog: CHANGELOG.md
