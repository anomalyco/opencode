# OpenCode Changelog

The changelog Worker renders the root `CHANGELOG.md` at `https://opencode.ai/changelog`.

It owns two routes, `opencode.ai/changelog` and `opencode.ai/changelog/*`. Requests for
`/changelog.json` and localized pages such as `/de/changelog` still reach the Console.

## Content

Each request reads `CHANGELOG.md` from the `dev` branch on raw GitHub through the Workers
cache. A copy stays fresh for five minutes. After that, the Worker serves the stale copy for up
to a day and refreshes it in the background. If GitHub fails, the stale copy is kept. Releases
appear without a deploy once the version-sync commit lands on `dev`.

Entries split on lines matching `^## v\d`. `### Highlights` items render first, and the
remaining `###` sections render as collapsible details. Raw HTML in the notes is escaped.

`/changelog/<version>` redirects to that release's anchor.

## Fonts

`public/changelog/fonts` holds the Latin-1 subsets of IBM Plex Serif and IBM Plex Mono from
`@ibm/plex`, licensed under the SIL Open Font License (`LICENSE.txt`).

## Development

```sh
bun dev
bun test
bun typecheck
bun run build
```

`deploy-changelog.yml` deploys with Wrangler on pushes to `dev` that touch this directory.
