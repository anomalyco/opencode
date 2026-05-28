# Local Setup

Documento inicial gerado automaticamente a partir do manifesto e dos scripts detectados no projeto.

## Prerequisites

- Runtime / stack: undefined
- Package manager: bun
- Database: PostgreSQL
- External access: none documented
- Secrets: review .env files and CI secrets before running protected flows

## Install

```bash
review the project manifest and install its dependencies
```

## Start

```bash
bun run dev
```

## Validate

```bash
bun run lint && bun test
```

## Expected services

| Service | URL | Health check |
|---|---|---|
| Frontend | http://localhost:3000 | http://localhost:3000/ |

## Demo access

- Flow: NextAuth/Auth.js session flow
- Demo user: not detected
- Demo password location: not documented

## Evidence

```bash
npx playwright test
```
