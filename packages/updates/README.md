# OpenCode Updates

The updates Worker serves all selected artifacts for a channel.

```sh
curl 'https://update.opencode.ai/api/latest'
curl 'https://update.opencode.ai/api/latest/cli'
curl 'https://update.opencode.ai/api/latest/cli/npm'
```

The `/admin*` route must be protected by a Cloudflare Access self-hosted application. Configure the application with:

- Public hostname: `update.opencode.ai`
- Path: `admin*`
- Policy: allow the OpenCode team identity group

The Worker has `workers_dev` and preview URLs disabled so the custom hostname is its only public entry point.

## Request logging

Every request reaching the Worker emits an unsampled event at request start to the shared production
Cloudflare lake stream through the `EVENTS` Pipelines binding. Events use
`source: "update"`, `type: "request"`, an ISO `timestamp`, and a `payload` containing
the method, path, `user_agent`, country,
and Cloudflare colo. Query strings, request bodies, cookies, authorization headers,
and IP addresses are not included. Response status and duration are not recorded.

Delivery runs in `waitUntil` without delaying the response. Delivery failures are
logged but do not fail requests or retry; this is not lossless audit logging.
Requests blocked before reaching the Worker are not recorded.

The stream ID in `wrangler.jsonc` comes from the `lake.stream` output of the
`anomalyco/platform/production` Pulumi stack. Update the binding if that stream is
replaced. The stream is shared across release channels because the update service
has a single public deployment.

## Publishing

GitHub Actions publishes artifacts through `POST /api/publish` using a short-lived OIDC token with audience `https://update.opencode.ai`. The Worker accepts only tokens signed by GitHub for repository ID `975734319`, owner ID `66570915`, and `.github/workflows/publish.yml` on configured publishing refs.

Apply migrations and deploy from this directory:

```sh
bun run db:migrate
bun run deploy
```
