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

## 2. Prepare the workspace on the VPS

Create a dedicated directory for the customer repo or workspace, for example:

```bash
mkdir -p /srv/numeral/customer1/workspace
```

Only mount paths that this customer is allowed to access. Numeral is not a security sandbox.

## 3. Configure environment variables

Copy `.env.example` to `.env` and fill in:

- `NUMERAL_DOMAIN`
- `LETSENCRYPT_EMAIL`
- `OPENCODE_SERVER_PASSWORD`
- `VITE_OPENCODE_LICENSE_URL`
- `CUSTOMER_WORKSPACE`

## 4. Start the stack

From this directory:

```bash
docker compose up -d --build
```

## 5. Verify access

Open:

```text
https://<NUMERAL_DOMAIN>
```

The server should require HTTP Basic Auth using:

- username: `OPENCODE_SERVER_USERNAME` or `opencode`
- password: `OPENCODE_SERVER_PASSWORD`

## Notes

- The backend serves the locally built `packages/app/dist` when `OPENCODE_WEB_DIST` is set.
- The web app bakes in `VITE_OPENCODE_LICENSE_URL` at build time and uses it for `POST /v1/licenses/activate` and `POST /v1/licenses/refresh`.
- If no local web build is present, the server falls back to proxying `app.opencode.ai`.
- Customers should add their own model/provider credentials inside the running app.
