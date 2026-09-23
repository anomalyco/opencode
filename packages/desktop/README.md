# OpenCode Desktop

The OpenCode Desktop app, built with Electron.

## Development

```bash
bun install
bun dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```

Production builds require a prebuilt V2 CLI distribution. The release workflow supplies the artifact from the same run:

```bash
OPENCODE_CHANNEL=prod OPENCODE_CLI_DIST=/absolute/path/to/packages/cli/dist bun run build
OPENCODE_CHANNEL=prod bun run package
```

Set `OPENCODE_CLI_TARGET` when packaging for a different architecture. The CLI is placed outside `app.asar` in the
application's resources directory, and packaging fails if it is missing.

CLI preparation uses these channel rules:

| Channel                                | Without `OPENCODE_CLI_DIST`    | With `OPENCODE_CLI_DIST`                      |
| -------------------------------------- | ------------------------------ | --------------------------------------------- |
| `dev`, `local`, unset, or unrecognized | Download the dev CLI           | Download the dev CLI; ignore the distribution |
| `beta`                                 | Download the beta CLI          | Copy the supplied CLI; fail if it is missing  |
| `prod`, `latest`                       | Fail before changing resources | Copy the supplied CLI; fail if it is missing  |

`bun dev` is separate from packaging: it uses local renderer/server mode, the dev app identity, and the CLI source by
default. `bun dev --download-server <version>` instead downloads that CLI version for local development. Neither path
requires `OPENCODE_CLI_DIST` or runs the production prebuild.

## Startup benchmark

`bun run bench:startup` measures a **packaged** build from process spawn to the restored tab being ready and the
renderer going idle, so dev-server and bundling costs are not part of the numbers.

```bash
OPENCODE_CHANNEL=dev bun run build && bunx electron-builder --win --dir --config electron-builder.config.ts
bun run bench:startup -- --runs 5                                  # warm service (started once, reused by every launch)
bun run bench:startup -- --runs 5 --compare dist/other/OpenCode\ Dev.exe   # A/B: alternate launches of two builds
bun run bench:startup -- --service cold                            # each launch spawns the service
bun run bench:startup -- --fresh                                   # first launch after an install (profile wiped each time)
bun run bench:startup -- --profile-main --profile-renderer --trace # CPU profiles and a Chromium startup trace
bun run bench:startup -- --seed "%APPDATA%\ai.opencode.desktop.dev"   # restore tabs and drafts from an existing profile
```

The app runs in an isolated home (`%TEMP%\opencode-bench-startup`): its own `%APPDATA%`, XDG directories, OpenCode
database, config and service registration, with the developer's `OPENCODE_*` and `OTEL_*` environment stripped
(an inherited OTLP endpoint alone adds a network round trip to every CLI exit). It never attaches to or restarts the
developer's live service, and only ever kills the process tree it spawned. `--service cold` stops the service before
each launch so the desktop has to spawn it; the isolated config directory gives that service a private port. One
`--warmup` launch per build is discarded by default because the first launch of a new binary pays the antivirus scan.
`--compare` alternates two builds so machine drift affects both equally; they must bundle the same CLI or the desktop
restarts the service on the version mismatch.

Milestones (ms since spawn) come from the main log, the renderer's performance timeline and DOM readiness polled over
CDP. Node's bootstrap timing is read from the main process after each run over `--inspect` (nothing attaches until the
run is over): `processCreated` → `nodeStart` is Electron's native init, `nodeStart` → `nodeBootstrapped` is Node
itself, and `nodeBootstrapped` → `appStarting` is Electron's JavaScript init plus our main bundle up to its first
log line. Renderer idle is the start of the first 500 ms window with under 10 % main-thread task time that stays quiet
for `--settle-ms`; `rendererTaskMs` is the renderer's total main-thread task time until then. Raw samples are
written to `dist/bench-startup`.

A packaged beta or prod build registers itself as the `opencode://` handler when it starts, even from the bench; the
installed app takes the registration back on its next launch. Those channels run with `HTTPS_PROXY` pointed at a
closed port (`--offline` forces it for dev) so the updater's first check fails fast instead of reaching GitHub.