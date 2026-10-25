# Changelog

Release notes for OpenCode V2, newest first.

## v2.0.27 — 2026-10-12

### Highlights

- **Built-In Worktree Tools**: Ask OpenCode to use `worktree_create`, `worktree_list`, and `worktree_remove` in Code Mode. You can create isolated worktrees, move sessions into them, and remove them with normal edit approval. ([#53981](https://github.com/anomalyco/opencode/pull/53981))
- **Safer Remote Pairing**: The first `opencode pair --remote` now warns that it will expose your server and asks for confirmation. For non-interactive use, pass `opencode pair --remote --yes`. ([#54561](https://github.com/anomalyco/opencode/pull/54561))
- **Installable Web App**: Use Chrome or Edge’s **Install** button to install the OpenCode web app, including when it runs behind an authenticating proxy. ([#53905](https://github.com/anomalyco/opencode/pull/53905))
- **Clear Session Failures**: Desktop and TUI timelines now show execution errors that happen before or between model steps instead of ending without an explanation. ([#53826](https://github.com/anomalyco/opencode/pull/53826))
- **Automatic Project Cleanup**: Projects whose directories no longer exist are automatically hidden from the project list. Opening the directory again restores the project. ([#54354](https://github.com/anomalyco/opencode/pull/54354))

### Core

#### Improvements

- Added the built-in Code Mode tools `opencode.worktree_create`, `opencode.worktree_list`, and `opencode.worktree_remove`. Removing a worktree requires edit approval, and `force: true` can discard modified or untracked files. ([#53981](https://github.com/anomalyco/opencode/pull/53981))
- Added confirmation before `opencode pair --remote` first enables internet access, plus `--yes`/`-y` for scripts and other non-interactive use. ([#54561](https://github.com/anomalyco/opencode/pull/54561))
- Automatically archived projects when all known directories disappear. Reopening a project restores it, while surviving clones and linked worktrees keep it active. ([#54354](https://github.com/anomalyco/opencode/pull/54354))
- Raised the ChatGPT OAuth input limit for `gpt-6.1-sol` and `gpt-6.1-sol-fast` to 500,000 tokens. ([#54668](https://github.com/anomalyco/opencode/pull/54668))
- Added Vertex AI routes for Interactions and Mistral models. ([#54175](https://github.com/anomalyco/opencode/pull/54175), [#54058](https://github.com/anomalyco/opencode/pull/54058))

#### Bug fixes

- Fixed updater detection for symlinked home directories and package-manager installations, increased probe timeouts, and now report unavailable updates clearly when the installation method cannot be detected. ([#54609](https://github.com/anomalyco/opencode/pull/54609), [#54622](https://github.com/anomalyco/opencode/pull/54622), [#54672](https://github.com/anomalyco/opencode/pull/54672))
- Fixed GitHub Copilot routing for Gemini, Anthropic, and Responses models when live model metadata is unavailable, and accepted interleaved Claude reasoning values. ([#54208](https://github.com/anomalyco/opencode/pull/54208), [#54210](https://github.com/anomalyco/opencode/pull/54210), [#54201](https://github.com/anomalyco/opencode/pull/54201))
- Fixed Google Vertex Application Default Credentials when `CLOUDSDK_CONFIG` points to a custom gcloud configuration directory. Thanks [@H-Max](https://github.com/H-Max). ([#54164](https://github.com/anomalyco/opencode/pull/54164))
- Prevented ChatGPT token-sharing sessions from sending unsupported mid-session reasoning-effort updates. ([#54085](https://github.com/anomalyco/opencode/pull/54085))
- Blocked `file://` access through Code Mode’s `fetch`, which now returns a clear filesystem-access error. Thanks [@ferdinandyb](https://github.com/ferdinandyb). ([#54510](https://github.com/anomalyco/opencode/pull/54510))
- Fixed remote workspace file operations so driver-provided filesystem overrides are used correctly.
- Preserved subagent notifications when location services are evicted, and propagated well-known configuration updates across locations with bounded HTTP timeouts. ([#54072](https://github.com/anomalyco/opencode/pull/54072), [#53821](https://github.com/anomalyco/opencode/pull/53821))

### TUI

#### Bug fixes

- Displayed session execution failures that occur before or between model steps directly in the timeline. ([#53826](https://github.com/anomalyco/opencode/pull/53826))
- Preserved a saved session’s unavailable model selection instead of silently replacing it with a fallback. ([#53822](https://github.com/anomalyco/opencode/pull/53822))
- Added syntax highlighting for C++ module interface files such as `.cppm`, `.ixx`, and `.cxxm`. ([#53853](https://github.com/anomalyco/opencode/pull/53853))
- Summarized integrations with multiple credentials as a connection count, preventing long labels from crowding the integration name. ([#54054](https://github.com/anomalyco/opencode/pull/54054))

### Desktop

#### Improvements

- Made the web app installable from Chrome and Edge, including deployments behind cookie-based authenticating proxies. ([#53905](https://github.com/anomalyco/opencode/pull/53905))
- Updated the session column layout and text wrapping for clearer long content. ([#54020](https://github.com/anomalyco/opencode/pull/54020))

#### Bug fixes

- Displayed session execution failures that occur before or between model steps directly in the timeline. ([#53826](https://github.com/anomalyco/opencode/pull/53826))
- Fixed command-palette selection so newly arriving higher-ranked results become active until you explicitly choose a result. ([#54275](https://github.com/anomalyco/opencode/pull/54275))
- Preserved bold, code, emphasis, and strike-through formatting inside Markdown link labels. ([#54451](https://github.com/anomalyco/opencode/pull/54451))
- Fixed timeline file links and complete patch rendering, including unusual filenames and patches whose original alignment can be reused. ([#53641](https://github.com/anomalyco/opencode/pull/53641), [#54017](https://github.com/anomalyco/opencode/pull/54017))
- Showed complete tool error text when an error is expanded. ([#53816](https://github.com/anomalyco/opencode/pull/53816))
- Fixed browser-panel controls, page visibility, corner masks, and closed side-region overlays. ([#53907](https://github.com/anomalyco/opencode/pull/53907), [#54038](https://github.com/anomalyco/opencode/pull/54038), [#52461](https://github.com/anomalyco/opencode/pull/52461), [#54052](https://github.com/anomalyco/opencode/pull/54052))
- Made the third-party notices dialog scrollable. ([#53911](https://github.com/anomalyco/opencode/pull/53911))

### SDK

#### Improvements

- Added startup plugin seeding to Effect embedded hosts and workerd through `OpenCode.create({ plugins })` and `OpenCodeWorkerd.create({ plugins })`.
- Re-exported `WorkspaceDriver`, `EnvironmentDriver`, and `EnvironmentFiles` from `@opencode/sdk/effect`.

#### Bug fixes

- Ensured embedded hosts activate supplied plugins before model discovery, generation, and recovery begin. ([#54219](https://github.com/anomalyco/opencode/pull/54219))

### Extensions

#### Improvements

- Extended `BridgeLayout` with viewport dimensions and optional border information so native extension surfaces can track window resizing and preserve rounded card borders.

#### Bug fixes

- Kept desktop browser-panel corner masks and borders aligned while resizing or using custom themes. ([#52461](https://github.com/anomalyco/opencode/pull/52461))
- Kept the browser site button clickable after the embedded page takes focus. ([#53907](https://github.com/anomalyco/opencode/pull/53907))

## v2.0.26 — 2026-10-08

### Highlights

- **Google Cloud Credentials for Vertex**: Run `/connect`, choose **Vertex**, then select **Google Cloud credentials (gcloud auth or environment)** to use Application Default Credentials. You can choose or enter the Google Cloud project and location. ([#53798](https://github.com/anomalyco/opencode/pull/53798))
- **Faster, Safer Session Snapshots**: Session snapshots now add less overhead, recover from interrupted or concurrent captures, restore large selections faster, and pack stored objects to reduce disk usage. ([#51996](https://github.com/anomalyco/opencode/pull/51996))
- **Working Transcript Links**: You can click links anywhere in a transcript, including any row of a wrapped URL. Hyperlinks also work in more terminals, and `FORCE_HYPERLINK=1` can enable them when automatic detection does not. ([#53903](https://github.com/anomalyco/opencode/pull/53903), [#53904](https://github.com/anomalyco/opencode/pull/53904))
- **Step 5 Preview Free**: You can now select **Step 5 Preview Free** from OpenCode’s free model lineup for a limited time.

### Core

#### Improvements

- Added **Google Cloud credentials (gcloud auth or environment)** to the Vertex connection flow, with project and location choices discovered from environment variables, gcloud configurations, and Application Default Credentials. ([#53798](https://github.com/anomalyco/opencode/pull/53798))
- Reduced session snapshot overhead, accelerated multi-file restores, made capture resilient to crashes and concurrent processes, and added lossless background packing of snapshot objects. ([#51996](https://github.com/anomalyco/opencode/pull/51996))
- Added **Step 5 Preview Free** to OpenCode’s free models for a limited time and removed the retired **Fledge Alpha Free** listing.

#### Bug fixes

- Prevented working-tree diffs from timing out or stalling the server in repositories with many untracked files by batching Git operations. ([#53449](https://github.com/anomalyco/opencode/pull/53449))
- Fixed large revert selections failing when their paths exceeded the operating system’s command-line limit. ([#53956](https://github.com/anomalyco/opencode/pull/53956))
- Fixed snapshot and undo handling for literal filenames containing Git pathspec characters, corrupted or locked snapshot indexes, concurrent captures, and project directories whose names begin with `..`. ([#51996](https://github.com/anomalyco/opencode/pull/51996))
- Changed `opencode service` remote-access URLs to use a persistent random subdomain rather than a predictable route. Disabling and re-enabling remote access generates a new address. ([#53962](https://github.com/anomalyco/opencode/pull/53962))

### TUI

#### Improvements

- Enabled OSC 8 hyperlinks in more terminals, including VS Code and other xterm.js terminals, Zed, mintty, and newer VTE terminals; `FORCE_HYPERLINK=1` now overrides terminal detection. ([#53904](https://github.com/anomalyco/opencode/pull/53904))

#### Bug fixes

- Fixed transcript links not opening when clicked, including URLs wrapped across multiple rows. ([#53903](https://github.com/anomalyco/opencode/pull/53903))
- Kept activity summaries in place when expanding or collapsing details with `session.verbosity: "low"`. ([#52357](https://github.com/anomalyco/opencode/pull/52357))
- Prevented the home-screen version footer from overlapping keyboard hints in short terminals. Thanks [@fihaaade](https://github.com/fihaaade). ([#53891](https://github.com/anomalyco/opencode/pull/53891))
