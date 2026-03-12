# dev-brendan branch

This branch is a personal build maintained by [@brendandebeasi](https://github.com/brendandebeasi).

It tracks `upstream/dev` (sst/opencode) with open PRs from the anomalyco org
cherry-picked on top. It is rebuilt automatically and should never be submitted
as a PR to sst/opencode or anomalyco/opencode.

## Updating

```bash
bash update-dev.sh
```

This fetches the latest upstream/dev, auto-discovers open PRs from anomalyco on
sst/opencode (skipping drafts and WIP), applies unique commits in topological
order, installs deps, and force-pushes to brendandebeasi/opencode.

## Adding a PR

PRs are discovered automatically via `gh pr list`. To track a specific PR that
wouldn't be auto-discovered, edit the override section in `update-dev.sh`.
