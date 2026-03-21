# Single-Customer VPS Deployment

This deploy bundle runs one Numeral instance for one customer on a VPS.

It uses:

- one Numeral container
- one Caddy container for HTTPS
- one bind mount for the customer workspace
- one persistent Docker volume for Numeral state

## 1. Point DNS to the VPS

Create an `A` record for your test domain, for example:

- `customer1.example.com -> <your-vps-ip>`

## 2. Prepare the VPS

Install the base packages first:

```bash
sudo apt update
sudo apt install -y git curl ufw fail2ban
```

Install Docker and the Docker Compose plugin.

Create the directories used by the runner and deployment:

```bash
sudo mkdir -p /srv/numeral/customer1/workspace
sudo mkdir -p /srv/numeral/app
```

Only mount paths that this customer is allowed to access. Numeral is not a security sandbox.

## 3. Harden SSH

Use a dedicated non-root admin user and a separate non-root GitHub runner user.

- disable password login
- disable root login
- use key-only auth
- enable `ufw`
- enable `fail2ban`

Deployment in this setup is performed by the self-hosted GitHub runner, not over SSH from GitHub-hosted runners.

## 4. Register the self-hosted GitHub runner

Create a repository-scoped runner on the VPS and assign these labels:

- `self-hosted`
- `linux`
- `x64`
- `prod-vps`

Keep the runner workspace separate from the mounted customer workspace.

You can install it with the helper script in this folder:

```bash
cd /srv/numeral/app
cp deploy/vps-single-customer/github-runner.env.example /tmp/github-runner.env
# edit /tmp/github-runner.env
set -a
. /tmp/github-runner.env
set +a
sudo -E \
  deploy/vps-single-customer/install-git-runner.sh
```

Get `GITHUB_RUNNER_TOKEN` from the repository runner setup screen in GitHub.

## 5. Prepare the workspace on the VPS

Create the dedicated customer repo or workspace mount if you have not already:

```bash
mkdir -p /srv/numeral/customer1/workspace
```

## 6. Configure environment variables

Copy `.env.example` to `.env` and fill in:

- `NUMERAL_DOMAIN`
- `LETSENCRYPT_EMAIL`
- `OPENCODE_SERVER_PASSWORD`
- `OPENCODE_SERVER_USERNAME`
- `VITE_OPENCODE_LICENSE_URL`
- `CUSTOMER_WORKSPACE`

The workflow and deploy script read this file from:

```text
/srv/numeral/app/deploy/vps-single-customer/.env
```

The deploy script requires these environment variables every time it runs:

- `DEPLOY_ROOT`
- `DEPLOY_BRANCH`
- `DEPLOY_REPO_URL`
- `DEPLOY_COMPOSE_FILE`
- `DEPLOY_ENV_FILE`
- `DEPLOY_SHA`

## 7. Bootstrap the deploy checkout

Clone the repo into the fixed deployment path used by the workflow:

```bash
git clone https://github.com/anomalyco/opencode.git /srv/numeral/app
```

The deploy workflow keeps this checkout on the `pro` branch and resets it to the exact commit being deployed.

## 8. Manual first start

From `/srv/numeral/app`:

```bash
cd /srv/numeral/app
DEPLOY_ROOT=/srv/numeral/app \
DEPLOY_BRANCH=pro \
DEPLOY_REPO_URL=https://github.com/anomalyco/opencode.git \
DEPLOY_COMPOSE_FILE=deploy/vps-single-customer/docker-compose.yml \
DEPLOY_ENV_FILE=deploy/vps-single-customer/.env \
DEPLOY_SHA=$(git rev-parse origin/pro) \
deploy/vps-single-customer/deploy.sh
```

## 9. Verify access

Open:

```text
https://<NUMERAL_DOMAIN>
```

The server should require HTTP Basic Auth using:

- username: `OPENCODE_SERVER_USERNAME` or `opencode`
- password: `OPENCODE_SERVER_PASSWORD`

## CI/CD flow

- pushes to `pro` run validation and deployment automatically
- `workflow_dispatch` supports an optional `ref` for redeploys and rollbacks
- the production workflow only runs on runners labeled `prod-vps`
- runtime secrets stay on the VPS in `.env`

## Notes

- The backend serves the locally built `packages/app/dist` when `OPENCODE_WEB_DIST` is set.
- The web app bakes in `VITE_OPENCODE_LICENSE_URL` at build time and uses it for `POST /v1/licenses/activate` and `POST /v1/licenses/refresh`.
- If no local web build is present, the server falls back to proxying `app.opencode.ai`.
- Customers should add their own model/provider credentials inside the running app.
