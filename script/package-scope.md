# npm scope migration

Repository-owned workspaces use `@opencode/*`. The executable names remain `opencode2` and
`opencode2-node`; the Node umbrella changes from `opencode-node` to `@opencode/cli-node`.

## Release inventory

Read-only registry audit on 2026-09-07 found all 33 names used by `publish.yml` and
`script/publish.ts`, with `thdxr` listed as maintainer. Each has `0.0.0-reserved`;
`@opencode/plugin-browser` additionally has a working `dev` release.

| Group         | Packages under `@opencode/`                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Libraries     | `ai`, `client`, `codemode`, `core`, `plugin`, `plugin-browser`, `protocol`, `schema`, `sdk`, `server`, `simulation`, `theme`, `ui`, `util` |
| Umbrellas     | `cli`, `cli-node`                                                                                                                          |
| Bun / Linux   | `cli-linux-arm64`, `cli-linux-arm64-musl`, `cli-linux-x64`, `cli-linux-x64-baseline`, `cli-linux-x64-musl`, `cli-linux-x64-baseline-musl`  |
| Bun / macOS   | `cli-darwin-arm64`, `cli-darwin-x64`, `cli-darwin-x64-baseline`                                                                            |
| Bun / Windows | `cli-windows-arm64`, `cli-windows-x64`, `cli-windows-x64-baseline`                                                                         |
| Node          | `cli-node-linux-arm64`, `cli-node-linux-x64`, `cli-node-darwin-arm64`, `cli-node-windows-arm64`, `cli-node-windows-x64`                    |

The user confirmed trusted publishing is already configured for all release packages.
The expected publisher is GitHub repository `anomalyco/opencode`, workflow `publish.yml`.
The browser plugin's trusted publisher was also verified directly before this migration.

The workspace names `app`, `console-app`, `console-resource`, `console-support`, `http-recorder`,
`script`, and `web` have no `private: true` flag but are not published by this release workflow.
Their new names returned HTTP 404. In particular, reserve/configure `@opencode/http-recorder`
before separately publishing it. Private workspaces need no npm reservation.

## Activation order

1. Trusted publishing for the release inventory is confirmed by the user.
2. Retain old-name, package-aware releases as minimum update artifacts.
3. Publish the new names and their channel tags. The CLI publisher activates update metadata
   only after its platform packages and umbrella have published.
4. Deploy the updated installer and V2 documentation with the matching channel releases.
5. Regenerate `nix/hashes.json` using `.github/workflows/nix-hashes.yml`; the renamed workspace
   paths change the fixed-output dependency tree. Nix was unavailable in the development environment.

The native and Node CLI minima were set and verified through the public update API:

| Channel / artifact  | Minimum package    | Version            |
| ------------------- | ------------------ | ------------------ |
| `beta/cli/npm`      | `@opencode-ai/cli` | `0.0.0-beta-19242` |
| `dev/cli/npm`       | `@opencode-ai/cli` | `0.0.0-dev-18952`  |
| `beta/cli-node/npm` | `opencode-node`    | `0.0.0-beta-19242` |
| `dev/cli-node/npm`  | `opencode-node`    | `0.0.0-dev-19265`  |

All four minimum releases remain under their old package names and contain package-aware
updating. The Node releases were also verified directly on npm before marking them minimum.

The installer follows the beta update service's `metadata.package` for the default release.
For explicit versions it tries the new scope and falls back to the old scope on HTTP 404,
so old clients can still install the minimum release.

## Compatibility boundaries

- npm migration uses `--force` and retains the old package so removal cannot unlink the new
  executable. Bun installs the new name with trusted lifecycle scripts and an isolated cache.
  Both migrations were exercised with real package managers, the production postinstall, and
  temporary Linux fixture packages for both executable names.
- pnpm and Yarn cross-name updates still return an explicit reinstall instruction. This
  migration does not provide an automatic transition for those package managers.
- Consumers of V2 SDK/plugin packages must change dependencies and imports together. npm does
  not redirect the old scope to the new one. No compatibility republish or deprecation was made.
- `@opencode-ai/pty` and its six platform dependencies remain published by the separate
  `anomalyco/opencode-pty` repository. `@opencode/pty` returned HTTP 404, so those dependencies
  deliberately retain their existing names.
- `github` and `packages/enterprise` still consume the published V1 SDK API. Their pinned
  `@opencode-ai/sdk` dependencies, the legacy documentation in `packages/web/src/content/docs`,
  and external dependency metadata in lockfiles retain their old names. Moving them requires
  an API migration, not a package-name substitution.
- Previously configured native provider entrypoints under `@opencode-ai/ai/*` resolve to
  the bundled `@opencode/ai/*` modules without changing user configuration.

## Local package verification

Build from `packages/cli`, then prepare tarballs without publishing or activating artifacts:

```sh
OPENCODE_CHANNEL=dev OPENCODE_VERSION=0.0.0-dev-99999 bun script/build.ts --single --skip-install
OPENCODE_CHANNEL=dev OPENCODE_VERSION=0.0.0-dev-99999 bun script/publish.ts --dry-run
```

From `packages/sdk`, `bun run verify:package` builds and packs the library dependency graph,
installs it in a temporary npm consumer, and checks Node and Workerd entrypoints locally.
