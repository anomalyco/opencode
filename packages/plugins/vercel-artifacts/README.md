# Vercel artifacts

An opt-in OpenCode plugin that publishes artifacts to Vercel. Each artifact is its own Vercel project, served at its production domain (`<project>.vercel.app`), which stays the same across updates.

## Install

```sh
opencode plugin add 'git+https://github.com/anomalyco/opencode.git#path:packages/plugins/vercel-artifacts'
```

Then give it a [Vercel access token](https://vercel.com/account/settings/tokens), either as `VERCEL_TOKEN` in the environment or as the plugin's `token` option. When the token reaches more than one team, also set `VERCEL_TEAM_ID` or the `teamId` option. Without a token the plugin adds nothing, and it never reads the Vercel CLI's sign-in.

```jsonc
{
  "plugins": [
    {
      "package": "git+https://github.com/anomalyco/opencode.git#path:packages/plugins/vercel-artifacts",
      "options": { "teamId": "team_..." },
    },
  ],
}
```

Publish with `provider: "vercel"`, or make it the default provider.

## What it publishes

|                        |                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static files and `spa` | Served as uploaded. With `spa`, paths that match no file serve `index.html`.                                                                                                           |
| `server`               | One self-contained ESM bundle on Vercel's Node.js runtime. Its default export's `fetch(request, env)` gets the public URL and `process.env`. Paths that match no static file go to it. |
| `blob` bindings        | A private Vercel Blob store each, connected with OIDC. Use `@vercel/blob` with `storeId: process.env.<NAME>_STORE_ID`.                                                                 |
| `crons`                | Vercel Cron Jobs. Each needs a `path`, which answers 401 to anything but Vercel's `CRON_SECRET`. Hobby teams run crons at most once a day.                                             |
| `private`              | Turns on Vercel Authentication for every deployment before anything is uploaded, so only the team's members can open it. Publishing fails rather than go out unprotected.              |

There's no `sqlite` or `kv`: Vercel functions have no persistent disk.

Secrets are set in the Vercel dashboard or with `vercel env add`, never through OpenCode. They reach the server after the next update.

Deleting an artifact deletes its Vercel project and keeps its Blob stores, so their data isn't lost. Delete those in the dashboard when you're done with them.

## Test

```sh
bun test
```

The tests run against an in-process fake of Vercel's API. `bun run test:live`, with `VERCEL_TOKEN` (and `VERCEL_TEAM_ID` if needed) set, publishes to that team in projects named `opencode-artifacts-test-*` and deletes what it made. Use a dedicated test team.
