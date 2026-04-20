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
> Instead of running `bun run dev:all`, you can create a Run Configuration in your IDE that executes `local-dev.ts` using Bun. Just make sure to pass `--env-file=.env.development` in your run arguments so the environment variables are loaded properly!

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
