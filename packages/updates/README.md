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

## CLI package targets

The CLI npm artifact keeps the existing top-level `version` and includes package
names by executable in release metadata:

```json
{
  "version": "2.4.0",
  "metadata": {
    "packages": {
      "opencode2": "@opencode/cli",
      "opencode2-node": "opencode-node"
    }
  }
}
```

The publisher advertises only packages it has finished publishing. Clients select
their own executable's entry and use their locally detected package manager.
The curl installation method still uses the V2 installer.
Explicit version upgrades stay on the currently installed package without an
endpoint lookup. Older artifacts without `metadata.packages` also retain the
installed package; when the map is present, a missing executable entry is an error.

Package-manager detection reads the installed wrapper's manifest, independently
of the advertised target. npm package-name migrations allow replacement of the
shared executable but retain the old global package: removing it can unlink the
new executable. Cleanup is a separate migration step.
pnpm and Yarn package-name changes currently require a manual reinstall: pnpm
rejects the shared executable, while Yarn can leave it pointing at the old package.
The updater reports an error for these migrations instead of claiming success.

Changing this metadata does not redirect pre-capability clients, which only read
`version`. Before retiring the old package, publish a bridge release and add
compatibility routing that keeps pre-bridge clients on that version. Until that
routing is deployed, every advertised version must still exist under the old name.

## Request logging

Every request reaching the Worker emits an unsampled event at request start to the shared production
Cloudflare lake stream through the `EVENTS` Pipelines binding. Events use
`source: "update"`, `type: "request"`, an ISO `timestamp`, and a `payload` containing
the method, path, `useragent`, `ip` (from Cloudflare's `CF-Connecting-IP` header),
country, and Cloudflare colo. Query strings, request bodies, cookies, and authorization
headers are not included. Response status and duration are not recorded.

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
