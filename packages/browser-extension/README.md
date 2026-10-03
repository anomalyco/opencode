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
npx opencode-browser-cli install   # registers the helper, adds Browser Control, copies the extension
```

The helper is the `opencode-browser-cli` npm package in `cli/` (`bun run build` there bundles it with this
extension's build). It asks your installed opencode for the service with `opencode service start` and
`opencode service get password`, so it works with any opencode release. `opencode browser install` does
the same from the opencode CLI.

1. Open the browser's extensions page, turn on **Developer mode**, choose **Load unpacked**, and select
   the folder `install` prints (or `packages/browser-extension/dist` when building from source). The manifest key keeps the extension ID stable
   (`afeafocngkodbmaipcngoamamfmekgfo`).
2. For site scripts, choose **Details** on OpenCode Browser and turn on **Allow user scripts**.
3. Click the toolbar icon, or press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd>, to open the panel.

`opencode browser install` registers the `ai.opencode.browser` native messaging host for every
installed Chromium browser on macOS and Linux (a manifest in each browser's `NativeMessagingHosts`
directory) and on Windows (per-user registry keys), matching the browsers ChatGPT's extension supports. The host is the opencode CLI itself (`opencode browser host`): it starts the
background service if needed and returns its URL and password, so the panel connects without
configuration. The extension also hands the host its opencode plugin (`plugin/opencode-browser.ts`, the
`site_scripts` and `browsing` tools), which is written to `~/.config/opencode/plugins/opencode-browser.ts`
whenever it changes, so the plugin always matches the installed extension. Without the host, the panel
offers a manual URL and password form. `opencode browser status` and `opencode browser uninstall`
check and remove the registration.

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

The plugin file must stay self-contained (type-only imports): it is copied into opencode as-is.
