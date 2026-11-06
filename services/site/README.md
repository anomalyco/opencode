# SolidStart

Everything you need to build a Solid project, powered by [`solid-start`](https://start.solidjs.com);

## Creating a project

```bash
# create a new project in the current directory
npm init solid@latest

# create a new project in my-app
npm init solid@latest my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

### GitHub API

The Worker holds no GitHub token. Stars, contributors and avatars come from the build-time snapshot
(`script/github-snapshot.ts`, `src/lib/github-snapshot.json`). The changelog reads releases from the
GitHub API without a token (`src/lib/changelog.ts`, `src/lib/github-api.ts`), cached for 15 minutes in
memory and at the edge, with the snapshot as fallback. Without a token GitHub allows 60 calls an hour
per IP; in dev the last good releases are kept in `$TMPDIR/opencode-site-github/`, so a restart while
rate limited still has them. The snapshot script uses `GITHUB_TOKEN` when it is set (CI passes the
workflow's own token):

```bash
GITHUB_TOKEN=$(gh auth token) bun ./script/github-snapshot.ts
```

Never commit a token.

## Building and deploying

`bun run build -- --mode dev` builds the site (Nitro's `cloudflare-module` preset) into the Build Output
Specification tree in `.cloudflare/output`; `bun run deploy:dev` builds and runs
`cf deploy --prebuilt --mode dev`. `cloudflare.config.ts` defines the Worker (`opencode-site-dev` on
dev.opencode.ai, `opencode-site-production` on opencode.ai), its bindings and its routes. CI deploys on
pushes to `dev` and `production` (`.github/workflows/deploy-site.yml`). Production takes no routes until
`productionOwnsRoot` is switched on.

### Email sign-up

The home page's sign-up adds addresses to the OpenSend newsletter list (`src/lib/opensend.ts`) with
the `OPENSEND_API_KEY` secret, a live OpenSend API key with manage permission. `cloudflare.config.ts`
declares it, so a deploy fails until it's set on the Worker:

```bash
read -s OPENSEND_API_KEY
bunx cf workers secrets update OPENSEND_API_KEY --worker opencode-site-dev --text "$OPENSEND_API_KEY"
```

In `bun run dev`, export `OPENSEND_API_KEY` to send real sign-ups; without it the form answers as if
it worked and says nothing was sent.

The V2 docs at `/v2` are part of this app (`src/docs/`, see `src/docs/AGENTS.md`). `script/build.ts` prerenders
them into the Worker's assets after `vite build`.

## This project was created with the [Solid CLI](https://github.com/solidjs-community/solid-cli)
