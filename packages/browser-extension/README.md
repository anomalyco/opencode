# OpenCode Browser

opencode in the side panel of Chromium browsers (Chrome, Edge, Brave, Opera, Vivaldi, Chromium, Helium, Arc). Chat with the
local opencode service next to any page, let the agent use real tabs, and extend sites with site scripts.

- **Side panel chat** with the desktop app's session timeline, composer, and permission and question docks.
- **Browser control:** the built-in `browser.*` tools drive the tabs the agent opens and the tabs you share,
  with a visible agent cursor. Agent tabs are grouped as "opencode".
- **Site scripts:** userscripts the extension injects itself (`chrome.userScripts`), installed from replies or
  by the agent with your approval, toggled live per site.
- **Browsing data:** history, bookmarks, top sites, and recently closed tabs, after you allow it per
  conversation.

## Install

```sh
npx opencode-browser-cli install
```

1. Open the browser's extensions page, turn on **Developer mode**, choose **Load unpacked**, and select
   the folder `install` prints (or `packages/browser-extension/dist` when building from source). The
   manifest key keeps the unpacked extension ID stable (`afeafocngkodbmaipcngoamamfmekgfo`); the Chrome
   Web Store build is `mfnicocicmmlkpjnaffgihfjhdgjkdjg`.
2. For site scripts, choose **Details** on OpenCode Browser and turn on **Allow user scripts**.
3. Click the toolbar icon, or press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd>, to open the panel.

## The helper (`cli/`, npm `opencode-browser-cli`)

The extension finds the local opencode service through a Chrome native messaging host, `ai.opencode.browser`.
The helper is a standalone npm package so opencode itself needs no changes, and it works with any opencode
release:

- `install` copies the helper to `~/.local/share/opencode-browser` (npx caches can be cleared) and registers
  the host for every installed Chromium browser: a manifest in each browser's `NativeMessagingHosts`
  directory on macOS and Linux, per-user registry keys on Windows (the browsers ChatGPT's extension supports,
  plus Helium and Arc). It also adds the Browser Control MCP server to opencode's global config, starts the
  service, and copies the bundled unpacked extension next to the helper.
- `host` is what the browser starts. It answers the extension with the service URL and password from
  `opencode service start` / `opencode service get password`, and writes the extension's opencode plugin
  (`plugin/opencode-browser.ts`: `site_scripts`, `browsing`, and `browser.tabs.request`) to
  `~/.config/opencode/plugins/opencode-browser.ts` whenever it changes, so the plugin always matches the
  installed extension.
- `status`, `extension` (opens the unpacked folder), and `uninstall`.

Without the helper, the panel offers a manual URL and password form.

## Releasing

`cli/package.json` holds the release version; the store zip and the bundled extension are stamped with it.

1. Bump `version` in `cli/package.json` and merge.
2. Push a tag `browser-extension-v<version>`. The `publish-browser-extension` workflow builds the
   extension and the helper, publishes `opencode-browser-cli` to npm (skipped when that version exists),
   and attaches `opencode-browser-<version>.zip` to a GitHub release.
3. Upload that zip in the Chrome Web Store dashboard.

Locally: `bun run package` writes the store zip to `release/`; `cd cli && bun run build` builds the helper.

## How it connects

| Piece | Talks to | Over |
| --- | --- | --- |
| Side panel (`src/sidepanel`) | opencode service | `@opencode/client` HTTP and the event stream |
| Side panel | background worker | one `chrome.runtime` port (`src/shared/protocol.ts`) |
| Background (`src/background`) | `opencode.browser` plugin | `experimental.browser` RPC, attach v4, per session |
| Background | tabs | `chrome.debugger` (CDP), `chrome.tabs`, `chrome.userScripts` |
| Background | `opencode-browser` plugin (`plugin/`) | `opencode-browser.relay` RPC, while a panel is open |

The background implements the same browser contract as the desktop pane
(`packages/gui-extensions/src/browser`): the server plugin owns tools and permissions, the extension owns
tabs and runs commands. Page operations, diagnostics, and profiling are ported from that package; keep them
in step. Showing a session in the panel attaches its browser, which replaces another client's attachment for
that session.

Not available from an extension: heap snapshots (Chrome does not expose `HeapProfiler` to extensions) and
Lighthouse. CPU profiles are rebuilt from the v8 sampling profiler's trace events.

## Development

```sh
bun run dev       # rebuilds dist/ on change; reload the extension to pick it up
bun typecheck
```

The plugin file must stay self-contained (type-only imports): the helper copies it into opencode as-is.
