# Cloudflare artifacts

An opt-in OpenCode plugin that publishes artifacts to Cloudflare Workers: static sites, single-page apps, and apps with a server, D1, KV, R2 and Cron Triggers. Each artifact gets its own Worker at `https://<worker>.<subdomain>.workers.dev`. Every artifact is public.

## Install

```sh
opencode plugin add 'git+https://github.com/anomalyco/opencode.git#path:packages/plugins/cloudflare-artifacts'
```

Artifacts need `"experimental": { "artifacts": true }`. The provider registers only when it has an account ID and an API token, from `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` or from the plugin's `accountId` and `apiToken` options. It never reads Wrangler's login or a keychain.

```jsonc
{
  "plugins": [
    {
      "package": "git+https://github.com/anomalyco/opencode.git#path:packages/plugins/cloudflare-artifacts",
      "options": { "accountId": "<account id>" },
    },
  ],
}
```

The token needs Workers Scripts, D1, Workers KV Storage and Workers R2 Storage edit permissions, and the account needs a workers.dev subdomain. `prefix` (default `opencode`) starts the name of every Worker, database, namespace and bucket the provider creates.

## What it deploys

A folder without `artifact.json` is uploaded as static assets. With `artifact.json`:

- `assets` is served as files before the Worker sees a request, and `spa: true` serves `index.html` for navigations that match no file.
- `server` is one bundled ES module whose default export is `{ fetch }` or a `WorkerEntrypoint` class. A generated entry module runs it.
- Each binding gets its own D1 database (`sqlite`), KV namespace (`kv`) or R2 bucket (`blob`), pinned by binding name in the artifact's receipt.
- `migrations` are applied before the new Worker uploads, each file atomically and once, recorded in `d1_migrations` the way `wrangler d1 migrations apply` does. A failed upload leaves the old Worker serving the migrated database, so migrations must be ones the old code tolerates.
- `crons` become native Cron Triggers. A cron with a `path` sends a request to that path inside the Worker, and the path answers 404 from outside.

Secrets stay out of OpenCode. Set them with `npx wrangler secret put <NAME> --name <worker>`; every upload keeps them.

Deleting an artifact deletes its Worker. Its D1 databases, KV namespaces and R2 buckets stay in the account.

## Test

`bun run test` runs the provider against an in-process fake of Cloudflare's API, including the conformance suite in `packages/core/test/lib/artifact-conformance.ts`.

`bun run test:live` runs the same suite, a runtime check of every binding, the cron path and an out-of-band secret against a real account. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Everything it creates is named `opencode-artifacts-test*`, and it deletes all of it afterwards, then lists the account to confirm.
