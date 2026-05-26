# gruntcode — grunt-it soft-fork of opencode

**gruntcode is a soft-fork of [anomalyco/opencode](https://github.com/anomalyco/opencode) maintained by [grunt-it](https://github.com/grunt-it).** It exists to layer hivemind-native autonomous-coordination behavior on top of opencode without waiting for upstream review cycles.

## What's different from opencode

The only changes from upstream are a small, deliberately-scoped patch series that makes opencode work better with [hivemind-mcp](https://github.com/grunt-it/hivemind-mcp) — grunt-it's shared coordination MCP for parallel agent sessions.

Current patches (each tracked in [hivemind #222](https://github.com/grunt-it/hivemind-mcp)):

1. **Auto-announce-at-session-start.** TUI sessions automatically register themselves on the hivemind peer registry. No `hivemind_announce` TAKEOFF call needed.
2. **Attach subscribes to all session message updates.** When a wake fires via `/session/<id>/prompt_async`, the attach-client TUI renders the response. (Without this patch, externally-triggered messages land in the server's db but never reach the user's screen.)
3. **`OPENCODE_SERVER_URL` propagation.** The attach binary reads and propagates this env var to all subprocesses (MCP children, etc.) so agents can find their serve daemon without a launch-script shim.
4. **`--peer-id <id>` flag.** Lets launch scripts set the tab's hivemind peer-id at startup instead of via TAKEOFF gymnastics. Powers patch #1.

Everything else is opencode upstream. We rebase against `anomalyco/opencode:dev` weekly.

## Why a fork, not upstreaming?

We upstream each patch as a PR in parallel. The fork exists because:

- We need these patches *now* for the grunt-it autonomous-coordinator vision (the hivemind UI + multi-tab coordinator workflows depend on them)
- Upstream's contribution guidelines reasonably require design review for "core" changes; we don't want to wait
- Branding helps signal that hivemind <-> coding-agent integration is a grunt-it product, not just a config layer on top of someone else's tool

If upstream accepts a patch, we drop it on next rebase. The fork shrinks over time.

## Stability and support

**gruntcode tracks opencode upstream.** If you don't need hivemind integration, install [opencode](https://opencode.ai) directly — it's the same binary minus our four patches.

We do NOT promise:
- API stability beyond what opencode itself promises
- Independent feature work on top of opencode's TUI / agents / providers
- Backports of opencode bugfixes (you get them on next rebase, typically within a week)

We DO promise:
- The four hivemind-integration patches stay working as long as the hivemind-mcp tools they target stay working
- Weekly rebase on upstream `dev`
- Tagged releases as `vX.Y.Z-grunt.N` where `X.Y.Z` is the upstream version we rebased on

## Installation

```sh
brew install grunt-it/tap/gruntcode
```

Or build from source:

```sh
git clone https://github.com/grunt-it/gruntcode.git
cd gruntcode
bun install
bun run --cwd packages/opencode src/index.ts --help
```

## Contributing

For patches that should land in **opencode upstream**: open the PR there directly. We'll see it and drop our equivalent on next rebase.

For patches that are **gruntcode-specific** (i.e. hivemind-integration only, not general opencode improvements): open a PR against `grunt-it/gruntcode:dev`. We keep our patch series tiny — please discuss in [hivemind #222](https://github.com/grunt-it/hivemind-mcp) before opening a large change.

For everything else: use upstream opencode.

## Rebase workflow (maintainer notes)

Each grunt-it patch lives as a single commit on top of upstream `dev`. The history looks like:

```
upstream/dev
├── upstream commits (we rebase on these)
└── grunt-it patches (cherry-picked on top, one commit each)
    ├── chore(grunt): branding (README, GRUNTCODE.md, etc.)
    ├── feat(grunt): --peer-id flag (#222 patch 4)
    ├── feat(grunt): OPENCODE_SERVER_URL propagation (#222 patch 3)
    ├── feat(grunt): attach subscribes to all session updates (#222 patch 2)
    └── feat(grunt): auto-announce-at-session-start (#222 patch 1)
```

Weekly rebase:

```sh
git fetch upstream
git rebase upstream/dev
# resolve conflicts patch-by-patch
git push --force-with-lease origin dev
```

If a grunt-it patch lands upstream, drop it from the rebase chain (it's now part of the upstream commit set).

If a grunt-it patch conflicts non-trivially: file as a hivemind sub-ticket of #222, decide whether to update the patch or drop it.

## License

Same as upstream: [MIT](./LICENSE).
