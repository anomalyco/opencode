# Desktop MOD Beta

The desktop MOD beta loads folders from the MOD folder opened by the `Open MOD folder`
command. Each folder name must match `mod.json`'s `id`.

```
mods/
  example.mod/
    mod.json
    index.html
    app.js
```

```json
{
  "id": "example.mod",
  "name": "Example MOD",
  "version": "0.1.0",
  "description": "A local OpenCode MOD window",
  "engines": {
    "opencode": "^1.18.0"
  },
  "permissions": ["storage", "external.open", "ui.sidebar", "ui.command", "ui.style", "ui.host", "server.host", "server.database"],
  "entry": "index.html",
  "window": {
    "width": 960,
    "height": 720
  },
  "contributes": {
    "sidebar": [
      {
        "id": "notes",
        "title": "Project notes",
        "entry": "sidebar.html",
        "order": 10
      }
    ],
    "commands": [
      {
        "id": "open-notes",
        "title": "Open project notes",
        "panel": "notes"
      }
    ],
    "styles": "theme.css",
    "host": "host.js",
    "server": "server.js"
  }
}
```

Use the command palette to refresh MODs, enable or disable them, and open an enabled
MOD window. A disabled or incompatible MOD cannot run.

## Load priority and conflicts

Every MOD has a persisted load priority, initially `0`. The loader applies MODs from
the lowest priority to the highest; MODs with the same priority use a stable
name-and-id ordering. Use `Increase MOD load priority`, `Decrease MOD load priority`,
or `Reset MOD load priority` in the command palette to manage it. The allowed range
is `-1000` to `1000`.

When enabling a MOD from Settings, OpenCode first reloads the MOD folder and compares
the candidate against enabled MODs. It reports duplicate sidebar and command
contribution IDs, and warns when more than one MOD injects styles, host scripts, or
server plugins. The report lets you load the new MOD after the existing MODs, keep the
existing MODs later in the order, or open a new OpenCode session rooted at the MOD
folder to create a patch with AI. Load order can resolve cascade-style overlaps, but it
cannot make incompatible JavaScript or server behavior safe.

Changing a priority reloads the renderer. This makes the higher-priority MOD load
later, so it wins where ordinary last-applied semantics apply, such as CSS cascade
rules or host scripts that change the same DOM target. JavaScript behavior is still
owned by each MOD: two scripts that independently react to the same event can both
run, and priority cannot make incompatible logic safe.

MOD pages are served from a separate `oc-mod://` origin. They have no Node.js,
Electron, host DOM, filesystem, or raw IPC access. The page may only load local
assets from its own folder. Remote scripts, remote styles, forms, frames, and network
requests are blocked by Content Security Policy.

The MOD window gets this narrow API:

```ts
window.opencodeMod.getManifest()
window.opencodeMod.storage.get("key")
window.opencodeMod.storage.set("key", "value")
window.opencodeMod.storage.delete("key")
window.opencodeMod.openExternal("https://example.com")
window.opencodeMod.close()
```

`storage` and `openExternal` reject unless their corresponding permission is declared
in `mod.json`.

## Host UI contributions

`ui.sidebar` adds an icon to the legacy sidebar. Selecting it displays the declared
local page inside a sandboxed iframe. `ui.command` adds entries to the command palette.
A command with `panel` opens that sidebar panel; a command without `panel` opens the
MOD window. `ui.style` loads the declared local CSS into the main app, which is
intentionally powerful and should only be granted to MODs the user trusts.

An iframe does not receive `window.opencodeMod`. It can request the same limited
actions through `postMessage`:

```ts
function request(action, fields = {}) {
  const requestID = crypto.randomUUID()
  parent.postMessage({ source: "opencode-mod", requestID, action, ...fields }, "*")
  return new Promise((resolve, reject) => {
    addEventListener(
      "message",
      (event) => {
        if (event.data?.source !== "opencode-host" || event.data.requestID !== requestID) return
        event.data.ok ? resolve(event.data.value) : reject(new Error(event.data.error))
      },
      { once: true },
    )
  })
}

await request("storage.set", { key: "draft", value: "hello" })
const draft = await request("storage.get", { key: "draft" })
await request("external.open", { url: "https://example.com" })
await request("window.open")
```

Supported actions are `storage.get`, `storage.set`, `storage.delete`, `external.open`,
and `window.open`. The host verifies that the sender is the registered iframe and
enforces the MOD's permissions in the main process. MODs still do not receive host DOM,
Node.js, Electron, filesystem, raw IPC, arbitrary host routes, or modifications to
packaged OpenCode files.

## Full host takeover

`ui.host` is the trusted-MOD escape hatch. Its `contributes.host` script is loaded
directly into the OpenCode renderer rather than an iframe. It can access the host DOM,
the desktop bridge, and all browser APIs, so it can replace visible UI, add arbitrary
interactive tools, or integrate external local code. Treat it exactly like running
unreviewed local application code.

The script also receives `window.opencodeHost`. Obtain a MOD-scoped host at the
top level of the host entry:

```js
const mod = window.opencodeHost.forScript()
const mount = mod.ui.mount("example.toolbar", "[data-component='titlebar']")
mount.textContent = "My MOD UI"

mod.commands.register({
  id: "example.toggle",
  title: "Toggle example UI",
  onSelect() {
    mount.hidden = !mount.hidden
  },
})
```

The scoped API automatically removes its registered commands, mount nodes, injected
styles, and event listeners if the MOD is unloaded:

```js
const mod = window.opencodeHost.forScript()

mod.ui.style("layout", "[data-component='sidebar-rail'] { width: 84px }")
mod.ui.observe("[data-component='sidebar-rail']", (rail) => rail.classList.add("my-mod-rail"))
mod.events.on("opencode:my-mod-toggle", () => document.body.classList.toggle("my-mod-enabled"))

await mod.storage.set("setting", "enabled")
await mod.openExternal("https://example.com")

// Full desktop bridge access remains available for trusted host MODs.
const zoom = await mod.desktop.getZoomFactor()
```

`ui.mount(id, selector)` creates a stable child container under any host CSS selector.
`ui.style(id, css)` injects removable host CSS, and `ui.observe(selector, callback)`
waits for matching UI nodes, including nodes rendered later. `commands.register(...)`
adds a namespaced runtime command to the command palette and returns a dispose function.
The host reloads the renderer when a `ui.host` MOD is enabled, disabled, or refreshed
so injected state cannot survive a disable action.

## Server takeover

`server.host` is the trusted server-side counterpart to `ui.host`. Its
`contributes.server` entry is loaded into the local Desktop sidecar as an OpenCode
server plugin, after normal configuration plugins and in MOD priority order. It runs
with the same process, filesystem, network, and provider access as the local server,
so only enable MODs you trust. Server entries must be local ESM JavaScript files; the
MOD loader does not transpile TypeScript.

The entry uses the normal plugin module shape:

```js
export default {
  id: "retry-timeouts",
  async server() {
    return {
      "chat.retry": async (input, output) => {
        if (!(input.error instanceof DOMException) || input.error.name !== "TimeoutError") return
        output.retry = { message: "Request timed out; retrying" }
        output.delay = 1_000
      },
    }
  },
}
```

`chat.retry` runs after a model turn fails. Set `output.retry` to an object to force a
retry, `false` to suppress the built-in retry decision, and `output.delay` to choose a
non-negative delay in milliseconds. This lets a MOD handle provider timeouts without
changing built-in retry behavior.

The Desktop app restarts when a server MOD is enabled, disabled, refreshed, or moved
in load order. Server MODs only run against the local Desktop sidecar; WSL and remote
servers keep their own extension boundaries.

## Shared production chats

`server.database` is a trusted, declarative permission for a MOD that selects the
normal production session database:

```json
{
  "permissions": ["server.database"],
  "contributes": {
    "database": {
      "source": "production"
    }
  }
}
```

Enable this only in a development Desktop install. The sidecar restarts and uses the
same default `opencode.db` as the production channel, so sessions created in either
app are shared. The MOD cannot select an arbitrary database path. Do not run both
apps against the same session while either app is actively writing to it.

The repository includes the `share-production-chats` example MOD. Copy that folder
to the development build's MOD folder, which you can open with `Open MOD folder`,
then refresh and enable it from Settings > MODs. Disabling the MOD restarts the
sidecar and returns the development build to its channel-specific database.

## Recovery safe mode

Use `Disable all MODs (Safe Mode)` from the command palette to stop every MOD from
loading. If a trusted host MOD has replaced the command palette or broken the UI,
press `Ctrl+Shift+Alt+M` (`Cmd+Shift+Alt+M` on macOS) to toggle safe mode and reload
all OpenCode windows. The setting persists until toggled again.
