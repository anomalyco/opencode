# Changelog

Release notes for OpenCode V2, newest first.

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
