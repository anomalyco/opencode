# OpenCode Desktop

The OpenCode Desktop app, built with Electron.

## Development

```bash
bun install
bun dev
```

## Build

`bun run build` prepares `resources/` (icons, metainfo and the bundled CLI) and builds the app into `out/`.
`bun run pack` then packages it, unsigned, into `dist/desktop/` at the repository root: a `.app` tarball on macOS,
the unpacked app on Windows, and AppImage/deb/rpm on Linux. The release workflow signs and notarizes afterwards.

```bash
bun run build && bun run pack
```

Both read the same environment as every other release package:

| Variable           | Meaning                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `OPENCODE_CHANNEL` | `dev` (default), `beta`, or `latest`/`prod`. Picks the app identity, icons and bundled CLI.                     |
| `OPENCODE_VERSION` | Version stamped into the app and its packages.                                                                  |
| `OPENCODE_TARGET`  | `darwin-arm64`, `darwin-x64`, `windows-arm64`, `windows-x64`, `linux-x64`, `linux-arm64`. Defaults to the host. |

The CLI is placed outside `app.asar` in the application's resources directory, and packaging fails if it is missing.
`bun run build` uses `packages/cli/dist` when that holds the target's CLI. Otherwise `dev` (and `local`, unset or unrecognized)
downloads the published dev CLI, `beta` downloads the beta CLI, and `prod`/`latest` fail.

`bun dev` is separate from packaging: it uses local renderer/server mode, the dev app identity, and the CLI source by
default. `bun dev --download-server <version>` instead downloads that CLI version for local development.

## Beta channel

Every push to the `beta` branch publishes OpenCode Beta (`ai.opencode.desktop.beta`) as version `0.0.0-beta-<run>` to
the `beta` update channel. Beta publishes only the desktop app; the CLI and SDK packages ship
from `dev`. Install it from `https://opencode.ai/update/api/beta/desktop/opencode/<asset>`, for example
`opencode-desktop-mac-arm64.dmg` or `opencode-desktop-win-x64.exe`. Installed builds update in place on every platform.

## Startup benchmark

`perf/startup.bench.ts` times a launch with [strobe](https://github.com/anomalyco/strobe), from process spawn to what a
person waits for, in pairs of launches of two builds with an interval per case. Every launch runs in a private home
(its own `%APPDATA%`, XDG folders, database, config and service registration, the developer's `OPENCODE_*`, `OTEL_*`
and `SENTRY_*` environment removed), so it never touches the developer's app, profile or live service.

| Case                            | Launch                                                                              | Ends on      |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------ |
| launch to Home                  | Profile kept from earlier launches; the service already runs, from the bundled CLI. | Home         |
| launch to a restored tab        | Profile kept; the first launch's onboarding draft is restored.                      | The composer |
| launch to Home, service stopped | Profile kept; the desktop spawns its service.                                       | Home         |
| first launch                    | No profile or GPU shader caches: right after an install, onboarding opens a draft.  | The composer |
| dev start to Home               | `bun dev:desktop` with Vite's caches and `out` deleted.                             | Home         |

```bash
# A returning user's launches of two packaged builds (pack each with OPENCODE_CHANNEL=beta or prod), or two installed
# channels.
strobe bench perf/startup.bench.ts --target desktop --base exe:<old>/OpenCode.exe --head exe:<new>/OpenCode.exe
strobe bench perf/startup.bench.ts --target desktop --base app:opencode --head app:opencode-beta

# The first launch after an install.
strobe bench perf/startup.bench.ts --target install --base app:opencode --head app:opencode-beta

# The dev loop's cold start, dev against this checkout.
strobe bench perf/startup.bench.ts --target dev --base origin/dev --head .
```

strobe runs on Windows, macOS and Linux. Windows measures the most; on macOS a packaged launch needs a build whose bundle
id this account has never run (`packages/app/perf/README.md` lists what each OS gives).

Besides `launch.ready`, each launch reports its milestones as `launch.<name>` in ms since spawn: the main process's own
marks from its log (`entry`, `electron`, `window`, `served`, `bundle`, `logging`, `storage`, `init`, `layers`,
`visible`, `service.starting`, `service.ready`; `src/main/lifecycle/marks.ts`), or each step of the dev command's
output. `launch.painted` and `launch.settled` are when the window's pixels first and last changed, `cpu.work` is the CPU
every process used until ready, and `launch.node.*` is Node's bootstrap timing in builds that accept `--inspect`. The
first launch of each build is discarded, because a new binary pays the antivirus scan. The packaged
returning-user cases keep the GPU shader caches their build compiled in earlier launches, as a person's machine has
them; `first launch` starts each launch without them. `--why always` adds a profiled
launch per build: the main process and the renderer, both from their first statement.

A packaged beta or prod build registers itself as the `opencode://` handler when it starts, even from the bench; the
installed app takes the registration back on its next launch. Those channels run with `HTTPS_PROXY` pointed at a
closed port (`--offline` forces it for dev) so the updater's first check fails fast instead of reaching GitHub.
