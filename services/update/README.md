# OpenCode Update

The update Worker serves all selected artifacts for a channel from Cloudflare KV manifests
written at publish time.

```sh
curl 'https://opencode.ai/update/api/latest'
curl 'https://opencode.ai/update/api/latest/cli'
curl 'https://opencode.ai/update/api/latest/cli/npm'
```

The Worker serves only `opencode.ai/update/*` (and `dev.opencode.ai/update/*`); any other host
or path returns 404. `HEAD` lookups on `/update/api/*` answer with the same status and headers
as `GET`.

## Architecture

- **Reads (`GET` / `HEAD /update/api/*`):** Read only from the `MANIFESTS` KV namespace behind
  a 60-second per-isolate settled-value cache (bounded to 1,000 entries, no in-flight promise
  sharing). The read path never touches D1.
  - Per-distribution manifest key: `manifest:<channel>/<name>/<distribution>` containing
    `{ active, minimum? }` where each entry stores `{ version, metadata, time_created, time_updated }`.
  - Per-channel index key: `index:<channel>` containing `{ entries: [{ name, distribution }] }`
    sorted by `(name, distribution)` for `/api/<channel>` and `/api/<channel>/<name>` listings.
- **Writes (`POST /update/api/publish`):** Authenticated via GitHub Actions OIDC. Writes the
  release row to D1 (`DB`) for release history and authoritative active/minimum state, then writes
  the updated distribution manifest and channel index to KV. If a KV write fails, publish returns
  500 so the release workflow retries cleanly.

## Desktop update feeds

Electron updater manifests are available at `/api/<channel>/desktop/<distribution>/<filename>`:

```sh
curl 'https://opencode.ai/update/api/beta/desktop/opencode/latest-mac.yml'
```

Use `latest.yml` for Windows, `latest-mac.yml` for macOS, `latest-linux.yml` for Linux x64,
and `latest-linux-arm64.yml` for Linux ARM64. The distribution selects the stored download
URLs (`opencode` or `github`). Each manifest includes the selected artifact's version,
file URLs, SHA-512 checksums, sizes, and release date. Minimum-version selection
and `current`/User-Agent handling also apply to these feeds. Other fourth-segment paths look up
`metadata.files[filename]` and return a `302` redirect to the file URL.

## Minimum releases

Each `latest` name/distribution can mark one release as `minimum`, independently of its
`active` artifact. Pass `"minimum": true` in the `POST /update/api/publish` payload to set the
published artifact as the minimum (requires `channel: "latest"` and a comparable semver version),
omit `minimum` on subsequent publishes to preserve the existing minimum, or pass `"minimum": false`
to clear it. Preview build numbers reset, so `dev` and `beta` cannot set a minimum and lookups
ignore any existing non-`latest` minimum.

Clients send their running version as `?current=<version>` and use the CLI's default
`User-Agent: opencode/<channel>/<version>/cli`. When `current` is absent, the service
parses that User-Agent or the older `opencode/<version>` format.
The caller's channel comes from the default User-Agent, or from a preview version
such as `0.0.0-beta-18955` when that channel is absent. If an identified caller channel
differs from the requested channel, the service serves the active release without
applying the minimum. Historical `next` and `beta` count as the same channel.
A caller below the minimum receives that exact artifact; callers at or above it receive the active
artifact. An unparseable caller version receives the minimum. Requests with neither version source
receive the active artifact. All public API paths apply the same selection and use
`Cache-Control: no-store` because responses can depend on the User-Agent.

Version comparison uses semver, normalizing preview run numbers to numeric prerelease
identifiers and historical `next` versions to `beta`. The retired `/api/next`
channel transparently resolves to `beta` for older clients.

Choose a minimum that older clients can install and that can itself consume the active
release. For the CLI package migration, retain a package-aware release published as
`@opencode-ai/cli` as the minimum before activating releases under `@opencode/cli`.

The Worker has `workers_dev` and preview URLs disabled; it is exposed only through the
`/update` routes.

## Request logging

Every request reaching the Worker emits an unsampled event at request start to the shared production
Cloudflare lake stream through the `EVENTS` Pipelines binding. Events use
`source: "update"`, `type: "request"`, an ISO `timestamp`, and a `payload` containing
the method, path, `useragent`, `ip` (from Cloudflare's `CF-Connecting-IP` header),
country, and Cloudflare colo. The path is recorded without the `/update` prefix. Query strings,
request bodies, cookies, and authorization headers are not included. Response status and duration
are not recorded.

Delivery runs in `waitUntil` without delaying the response. Delivery failures are
logged but do not fail requests or retry; this is not lossless audit logging.
Requests blocked before reaching the Worker are not recorded.

The stream ID in `wrangler.jsonc` comes from the `lake.stream` output of the
`anomalyco/platform/production` Pulumi stack. Update the binding if that stream is
replaced. The stream is shared across release channels because the update service
has a single public deployment.

## Publishing

The release workflow registers direct binary downloads with distribution
`opencode`, after uploading every file to the public files bucket:

```sh
curl 'https://opencode.ai/update/api/dev/cli/opencode'
curl 'https://opencode.ai/update/api/dev/cli-node/opencode'
curl 'https://opencode.ai/update/api/latest/desktop/opencode'
```

`metadata.files` maps each filename to its direct
`https://opencode.ai/files/bin/<version>/<filename>` URL, SHA-256 checksum, and
byte size. Desktop records additionally contain `metadata.manifests`, with
the CDN URLs and SHA-512 checksums computed from the final signed files. Existing `npm`,
`github`, and `aur` distributions are published independently.

GitHub Actions publishes artifacts through `POST https://opencode.ai/update/api/publish`
using a short-lived OIDC token with audience `https://update.opencode.ai` (an identifier only;
that hostname is not served). The Worker accepts only tokens signed by
GitHub for repository ID `975734319`, owner ID `66570915`, `.github/workflows/release.yml`
and environment `release`. Pushes to `dev` may publish only to `dev`; only a
`workflow_dispatch` on `dev` (a versioned release) may publish to `latest`, and `beta`
publishes only to `beta`.

## Backfill and deploy

Before deploying the KV-backed Worker to production for the first time, create the `MANIFESTS`
KV namespace, set its `id` in both `services/update/wrangler.jsonc` and
`.github/release/targets/update/production/wrangler.json`, and backfill current active and
minimum rows from D1 into KV:

```sh
npx wrangler kv namespace create MANIFESTS
bun run kv:backfill -- --remote --dry-run
bun run kv:backfill -- --remote
```

The backfill script is idempotent and can also target a namespace ID directly with
`--namespace-id <id>` or local wrangler state with `--local`.

Apply migrations and deploy from this directory:

```sh
bun run db:migrate
bun run deploy
```
