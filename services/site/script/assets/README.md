# Product screenshots: always fresh

The screenshots on `/brand` (Screenshots) and `/press` (media, zips) must show the current release. This document
lists the current assets, describes a capture pipeline for each surface, and describes how CI keeps them fresh.

Status: **terminal is automated** (`script/capture-assets.ts`). The other surfaces are designs with commands and blockers.

## 1. Current assets (Nov 2 2026)

Latest release: **v2.2.5** (Oct 30 2026). Source: `gh api 'repos/anomalyco/opencode/releases?per_page=8'`.

| Used on                     | File                                                                   | Source                                                                         | Shows                                                                                                                           | Size                       | Mode | Problem                                                                                      |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| /brand Desktop              | `public/product-videos/capture-straight/desktop-landscape.jpg`         | Frame 0 of a video. Storybook stories + Playwright, then the CSS 3D compositor | Storybook build, model **"Claude Sonnet 4"**                                                                                    | 1920×1080 JPG, 1×          | Dark | Not the app. UI fills about 40% of the frame. Wrong model name                               |
| /brand Mobile               | `.../capture-straight/mobile-landscape.jpg`                            | Same as above, phone layout                                                    | **"Claude Sonnet 4"**                                                                                                           | 1920×1080 JPG              | Dark | Small phone in a landscape frame. Wrong model name                                           |
| /brand Terminal (preferred) | `.../capture-straight/terminal-landscape.jpg`                          | VHS + OpenCode TUI **2.2.2**, live free model                                  | Model **"Big Pickle"**                                                                                                          | 1920×1080 JPG              | Dark | 3 releases old. Wrong model name                                                             |
| /press stills (15)          | `public/press-media/frames/<slug>-frame-N.jpg`                         | `script/press-media.sh` takes frames from `real-straight/*.mp4` at fixed times | desktop: packages/app `origin/dev` bf544cd419 + e2e mock server; mobile: opencode-ios in the simulator; terminal/sdk: TUI 2.2.2 | 1920×1080 JPG (from H.264) | Dark | Frames from a video with zoom and motion blur. Some are crops in the middle of a camera move |
| /press films, posters       | `public/product-videos/{real,capture}-straight/*.{mp4,jpg}`            | Same recordings                                                                | 2.2.2 / origin/dev Oct 31                                                                                                       | 1920×1080, 1080×1350       | Dark | Posters are video frames, not stills                                                         |
| /press feature clips        | `public/product-videos/features/<slug>-N.{mp4,jpg}`                    | Same recordings                                                                | Same                                                                                                                            | 1600×1000                  | Dark | Same                                                                                         |
| Zips                        | `public/opencode-press-media.zip` (71 MB), `public/press-media/zips/*` | `script/press-media.sh`                                                        |                                                                                                                                 |                            |      | No version or date in the zip                                                                |

Common problems:

- No still is captured as a still. All of them come from H.264 video at 1×, so text is soft and there are no 2× files.
- Dark only. No light set.
- No manifest. Nothing records the product version or the capture date, so nothing can say when the assets are stale.
- The recordings are in a scratch folder (`$TMPDIR/opencode/product-videos/{real-cli,real-ui,real-ios}`, wiped by a reboot on Nov 3; the video editor now reads `PRODUCT_VIDEOS_DIR`, default `product-videos/` next to the checkout), not in the repo. Only the person who made them can run them again.
- `public/product-videos/` and `public/press-media/` are not tracked in git yet.

## 2. Pipeline

Rules for every surface:

- **Real product UI.** Use the released product (or a build of the release tag). Do not use Storybook for official stills.
- **Demo data only.** Use an isolated `HOME`, a fixture repo created by the script, and no real config, auth or sessions.
- **Stable text.** A scripted model (`script/assets/stub-model.ts`) replaces only the model. OpenCode still runs the tools: reads, the edit and its diff, the permission prompt and `bun test`. The model is named **"Claude Opus 5.5"** (provider "OpenCode").
- **Fixed geometry.** Logical window 1600×1000 at 2× (3200×2000 PNG). Light and dark from the product's own theme setting.
- **Names.** `<surface>/<surface>-<beat>-<mode>@2x.png`, for example `terminal/terminal-permission-light@2x.png`.
- **Manifest.** `manifest.json` records the OpenCode version, the capture time, the generator commit, and the width, height, size and SHA-256 of each file.

### Terminal (TUI): automated

```sh
cd packages/console/app
bun script/capture-assets.ts   # about 1 minute; writes ../../../../fresh-assets (next to the checkout)
```

How it works:

1. It starts the scripted model on a free local port (Bun.serve, OpenAI-compatible SSE).
2. For each mode, it writes an isolated `HOME` with `opencode.json` (provider `demo`, model "Claude Opus 5.5"), `cli.json` (`theme: { name: "opencode", mode }`, or the `--theme` and `--experiment` options) and the `my-app` fixture repo (git `main`, fixed commit date). It also dismisses the sidebar "Getting started" card. That card shows when no real provider is connected.
3. It writes a VHS tape that runs `opencode --standalone`, types the prompt and takes three `Screenshot`s: `home` (prompt typed), `permission` (diff and "Allow once"), and `done` (tests pass and summary). `Wait+Screen` reacts to the real UI, so there are no fixed sleeps for model output.
4. It writes `manifest.json` and `opencode-terminal-screenshots.zip`.

Requirements: `opencode` (or `OPENCODE_BIN=/path/to/build`), `vhs` 0.12+ (`brew install vhs`, which installs ttyd and uses headless Chrome), `bun`, `git` and `zip`. Font: `--font` / `CAPTURE_FONT` (default OpenTUI Mono, which must be installed; its OFL files are in anomalyco/opentui `packages/web/public/fonts`).

Output: `fresh-assets/` next to the checkout (override with `--out` or `FRESH_ASSETS_DIR`; not the temp folder, which a reboot wipes): 6 PNGs, 3200×2000, light and dark, manifest and zip. The /brand terminal pair is the `done` beat, copied to `public/brand/screenshots/opencode-terminal-{dark,light}.png` with 1600×1000 WebP previews (`cwebp -q 82 -m 6 -resize 1600 1000`), and `manifest.json` next to them feeds the "captured from" line.

#### Track the TUI on dev

The terminal capture must track the TUI version on `dev`, not only the last release: TUI design work lands on `dev`
first, often behind a TUI experiment flag, and the site must show it. On Nov 5 2026, James Long's dialog redesign
(muted-blue dialogs and permission dock with a blue key line on the left, instead of orange; #55498–#55751, #59996,
#60016, #60310) was on `origin/dev` behind `experimental["new-designs"]`, and the footage from v2.2.5 still showed the
orange dialogs. To capture from `dev`:

```sh
git worktree add --detach ../tui-dev origin/dev && cd ../tui-dev && bun install
cd packages/cli && OPENCODE_VERSION=<version in packages/cli/package.json> bun run script/build.ts --single --skip-install --skip-web-ui --outdir=<build dir>
cd <site checkout>/packages/console/app
OPENCODE_BIN=<build dir>/cli-darwin-arm64/bin/opencode bun script/capture-assets.ts --surface terminal --surface terminal-film \
  --experiment new-designs --theme opencode2 --out <out>
```

- `--experiment <name>` (repeatable) writes `experimental: { <name>: true }` into the fixture's `cli.json`.
  `--theme` sets the theme; `opencode2` is the new-designs theme, offered only with that experiment on.
- Set `OPENCODE_VERSION`, or the home screen shows `0.0.0-detached-<date>`.
- Each time the TUI on `dev` changes its look, capture again, copy the films to `product-videos/captures/terminal-film/`
  next to the checkout, and run the edits there (`cinematic/edits/*terminal*.json`, `press-terminal.json`). The new
  films keep the old beats within one frame, so the edits need no new timings. Then copy the outputs into
  `public/product-videos`, run `script/press-media.sh`, and re-run the media variants.
- Check that no old orange is left: `product-videos/cinematic/orange-check.py` (next to the checkout) finds solid regions of
  the old accent (#FAB181). Chrome (chips, key lines, selection bars) shows as regions of thousands of pixels;
  syntax-highlighted code stays under 100.
- When the experiment ships as the default, drop the two flags.

Text that still changes between runs: the run time and tok/s in the footer (`Build · Claude Opus 5.5 · 5.6s · 155.2 tok/s`), the "Thought · Nms" time and the `bun test` time (`[6.00ms]`). For that reason the SHA-256 changes on each run. To make the files byte-stable, the product team would need a frozen clock in the CLI (see section 5). Until then, compare captures with a perceptual diff, not with the hash.

### SDK: code-snippet render (not automated yet)

The SDK has no UI. Two options:

1. **Terminal capture (preferred).** Add a second VHS tape that opens the snippet in nvim and runs it in a split. This exists as a recording in `real-cli/term/gen.py` (`sdk2-*`). Move it into `capture-assets.ts` as `surfaces.sdk`, with the same stub model (it already replays the SDK steps) and `Screenshot` instead of video.
2. **Static render.** Render the snippet from `src/component/site/products.tsx` with Shiki and the OpenCode light and dark syntax themes in headless Chromium at 2×. This is simple and fully deterministic, but it does not show the product running.

The site's `sdkSnippet` shows the v2 `@opencode/sdk` API (`OpenCode.create()`); render that.

### Web: Playwright against `packages/app` (not automated yet)

`packages/app` already has the pieces: `e2e/utils/mock-server.ts`, `mock-api.ts` and `session-fixture.ts` answer every API call and push schema-validated session events. The `real-ui` recording (`$TMPDIR/opencode/product-videos/real-ui/drive/`) shows that this works with `page.clock` (fake clock) for deterministic frames.

Plan: a Playwright spec in `script/assets/web.spec.ts` that starts the app's Vite server from the release tag, opens a fixture session ("SAVE10 discount support"), plays the same scripted events, and takes:

```ts
await page.emulateMedia({ colorScheme: mode })
await page.setViewportSize({ width: 1600, height: 1000 }) // context: { deviceScaleFactor: 2 }
await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") })
await page.screenshot({ path: `web/web-session-${mode}@2x.png`, animations: "disabled" })
```

Blockers: the mock server lives in `packages/app/e2e` and is not exported. The product team must keep it stable or publish it as a fixture. The app's theme preference must be settable before load (local storage key or query parameter).

### Desktop: Electron with Playwright (not automated yet)

`playwright._electron.launch({ executablePath, args: [...], env: isolatedEnv })` against a packaged build of the release, with a demo workspace (the same `my-app` fixture) and the stub model. Use `electronApp.firstWindow()`, set the window to 1600×1000 with `BrowserWindow.setContentSize` through `electronApp.evaluate`, and use `page.screenshot()` at device scale factor 2 (macOS Retina, or `--force-device-scale-factor=2`).

Blockers:

- `page.screenshot()` cannot see native `WebContentsView`s (for example the in-app browser pane). Either skip those beats or use `webContents.capturePage()` in the main process and compose the two images.
- The desktop app needs a flag or an environment variable for an isolated user-data folder, a theme mode and no first-run onboarding. Check `packages/desktop/src` for existing flags; if there are none, the product team must add them.
- Packaged builds are signed and notarized. CI needs a macOS runner and the release artifact.

Until then, the web capture with the desktop window chrome (vertical tabs, titlebar) is a good fallback, as `real-ui` did.

### Mobile: iOS Simulator (not automated yet)

The `real-ios` recording builds `anomalyco/opencode-ios` in the simulator, drives it with XCUITest and talks to a local demo server with the stub model. For stills:

```sh
xcrun simctl boot "iPhone 17 Pro"
xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
xcrun simctl ui booted appearance light      # then dark
xcodebuild test -scheme OpenCode -only-testing:OpenCodeUITests/ScreenshotTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
xcrun simctl io booted screenshot mobile/mobile-session-light@3x.png
```

Simulator screenshots are native resolution (3× on Pro devices, 1206×2622). Keep them at 3×; the manifest records the scale.

Blockers: the iOS repo needs local patches to build with Xcode 26.3 (`real-ios/ios-build-fixes.patch`). The team builds with Swift 6.4. A `ScreenshotTests` UI test target and a demo-server launch argument must be in the iOS repo. This work belongs to the iOS team.

## 3. Freshness

### Capture

`script/capture-assets.ts` is the single entry point. Each surface is one function in `surfaces`. The plan is to replace `script/press-media.sh` with it: stills come from the capture, not from video frames. The films stay as they are and get their own manifest entries.

Proposed output in the site: `public/product-assets/<surface>/*.png` plus `public/product-assets/manifest.json`. JPG and WebP versions for the page and the thumbnails come from the PNGs.

### Check

```sh
GITHUB_TOKEN=$(gh auth token) bun script/check-assets.ts --manifest public/product-assets/manifest.json --max-behind 3
```

- **Fails** if the manifest is missing, if its major.minor is older than the latest release, or if it is more than `--max-behind` stable releases behind.
- **Warns** if it is 1 to `--max-behind` releases behind.
- Only `vX.Y.Z` tags count. Other tags, such as `process-daemon-v…`, are ignored.

Example with the current assets (2.2.2): `warning: Captured from v2.2.2 on 2026-10-31; latest is v2.2.5 (3 releases behind).` With `--max-behind 2`, it fails.

### CI (proposal, not added)

`.github/workflows/capture-assets.yml`:

```yaml
name: capture-assets
on:
  release:
    types: [published]
  workflow_dispatch:
  schedule:
    - cron: "0 6 * * 1" # weekly check
jobs:
  capture:
    if: github.event_name != 'release' || startsWith(github.event.release.tag_name, 'v')
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
        with: { ref: v2 }
      - uses: oven-sh/setup-bun@v2
      - run: brew install vhs
      # The released CLI (the package behind ~/.bun/bin/opencode). On workflow_dispatch, use the latest.
      - env: { TAG: "${{ github.event.release.tag_name }}" }
        run: |
          VERSION="${TAG#v}"
          bun add -g --trust "@opencode/cli@${VERSION:-latest}"
      - run: bun install
      - name: Capture
        working-directory: packages/console/app
        env: { CAPTURE_FONT: "JetBrains Mono" }
        run: bun script/capture-assets.ts --out public/product-assets
      - uses: peter-evans/create-pull-request@v7
        with:
          branch: fresh-assets
          title: "chore(console): capture product screenshots from ${{ github.event.release.tag_name || 'latest' }}"
          body: "Automatic capture. Review the images before merging."
          add-paths: packages/console/app/public/product-assets
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - working-directory: packages/console/app
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
        run: bun script/check-assets.ts --manifest public/product-assets/manifest.json
```

Add the `check` job to the site's build workflow too, as a warning only (`continue-on-error: true`), so a release does not block site deploys.

### Show the version on /brand and /press (proposal, not applied)

`src/lib/brand-content.ts` and `src/lib/press-content.ts` already read JSON manifests. Add:

```ts
import assetManifest from "../../public/product-assets/manifest.json"

export const capturedFrom = {
  version: assetManifest.opencodeVersion,
  date: assetManifest.capturedAt.slice(0, 10),
}
// Screenshots body: `Captured from v${capturedFrom.version} on ${formatDate(capturedFrom.date)}.`
```

Show it under the Screenshots title on /brand, next to "Download all" on /press, and in the Markdown versions (`brandMarkdown`, press Markdown). Write `manifest.json` into every zip (the capture script already does this).

## 4. Automatable now vs needs the product team

| Surface  | Now                                                          | Needs                                                                                                                           |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Terminal | Yes. `capture-assets.ts`, light and dark, 2×, about 1 minute | A frozen clock for byte-stable files (optional)                                                                                 |
| SDK      | Yes, after a small port of the existing nvim tape            | A decision on the SDK snippet (v1 vs v2 API)                                                                                    |
| Web      | Mostly. The e2e mock server and the fake clock already work  | A stable, exported fixture server. A theme setting before load                                                                  |
| Desktop  | Partly. Playwright can drive Electron                        | Flags for isolated user data, theme and no onboarding. A capture path for native views. A macOS CI runner with the signed build |
| Mobile   | Manual. Simulator scripts exist in a scratch folder          | A UI-test screenshot target and a demo-server launch argument in opencode-ios. Toolchain match (Swift 6.4)                      |

## 5. Requests for the product team

1. **CLI: a capture mode.** An environment variable, for example `OPENCODE_CAPTURE=1`, that freezes `Date.now()` and run timings, hides the version in the corner (or makes it explicit), and skips first-run cards. Then the files are byte-stable and the manifest hash shows real UI changes.
2. **Desktop: launch flags** for user-data folder, theme mode and onboarding.
3. **App: export the e2e mock server** as a fixture package.
4. **iOS: a `ScreenshotTests` target** that uses a launch argument for the demo server URL.
