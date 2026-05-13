# Veritly

Veritly is an AI-powered coding and spreadsheet workspace, forked and heavily customized from OpenCode.

This repository contains the microservices that power the Veritly platform. We have stripped out the desktop apps, old cloud configurations, and marketing materials to focus purely on the core web platform and its deployment to Kubernetes.

## Architecture

The Veritly stack is composed of several microservices:
- **Frontend** (`packages/app`): The Solid.js web application.
- **API Backend** (`packages/opencode`): The core backend service.
- **Relay** (`packages/relay`): A WebSocket relay server handling real-time spreadsheet synchronization.
- **Executor** (`packages/executor`): A secure environment for running code and operations.
- **PostgreSQL**: The primary database.

## Local Development

We have simplified the local development experience. You run the database using Docker, and the application services run directly via Bun on your machine. This makes it incredibly easy to point an IDE like IntelliJ or WebStorm directly to the code.

```bash
# This single script will spin up PostgreSQL via Docker,
# and then natively spawn the Frontend, API, Relay, and Executor via Bun.
bun run dev:all
```

> **IDE Debugging (IntelliJ / WebStorm / VS Code):**
> Instead of running `bun run dev:all`, you can create a Run Configuration in your IDE that executes `local-dev.ts` using Bun. Use **`--env-file=.env.development`** as a Bun CLI flag so variables load the same way as the terminal.
>
> **WebStorm / IntelliJ Bun configuration:** set **Working directory** to the **repository root** (the folder that contains both `local-dev.ts` and `.env.development`). If the working directory is e.g. `packages/opencode`, Bun looks for `packages/opencode/.env.development`, finds nothing, and `DEV_BACKEND_HOST` and friends stay unset. **Application parameters:** `--service backend` (or `compat`, `frontend`, `relay`, `all`). **Bun parameters:** `--env-file=.env.development`.

If you need to manage the database independently, the compose file is located at `docker/infra-deps-local-debugging.yml`.

## Production Deployment

Deployment to DigitalOcean Kubernetes is handled automatically via a unified bash script.

```bash
./deploy/k8s/deploy-production.sh
```
This script will:
1. Build all Docker images using `buildx`.
2. Push them to the DigitalOcean Container Registry.
3. Apply the Kubernetes manifests located in `deploy/k8s/base`.
4. Trigger a rolling restart of the deployments.
