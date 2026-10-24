# Desktop remote servers

Desktop reads `opencode.settings` in its channel's Electron user-data directory. On macOS:

- Beta: `~/Library/Application Support/ai.opencode.desktop.beta/opencode.settings`
- Stable: `~/Library/Application Support/ai.opencode.desktop/opencode.settings`
- Development: `~/Library/Application Support/ai.opencode.desktop.dev/opencode.settings`

Quit Desktop before editing this JSON file, preserve existing keys, then launch a build with this feature:

```json
{
  "servers": [
    {
      "url": "https://studio.example:4096",
      "name": "Studio",
      "passwordFile": "~/.config/opencode/studio.password"
    }
  ],
  "defaultServer": "https://studio.example:4096",
  "startLocalServer": false
}
```

`url` must be an HTTP(S) origin, without user information, a path, query or fragment. `name` and `passwordFile` are optional. Duplicate URLs and a default not in `servers` are errors. `defaultServer` opens Home on that server in the focused window (or the first window at launch), ahead of its saved Home selection. Other windows keep their routes. Existing session tabs remain available.

An explicit `startLocalServer` wins. Otherwise setting `defaultServer` disables managed local startup; with neither setting, Desktop keeps its existing local startup behavior. Disabling startup does not stop a service already running. Remote connection failure never starts a local fallback. With startup disabled and no servers, the existing Add server screen opens.

On macOS/Linux, `passwordFile` must be a regular file with no group or world permissions (`chmod 600`). Relative paths resolve beside `opencode.settings`; `~/` resolves to the current user's home. The file contains the password, optionally followed by one newline. The username is `opencode`. On Windows, password files work but POSIX mode-bit checks are skipped; restrict access using Windows file permissions (ACLs). Plain `password` fields and credentials in URLs are rejected.

If settings or a password file cannot be read or validated, Desktop discards the file-defined server list for that launch and uses its usual local server startup, even if the refused settings specified `startLocalServer: false`. A notice says that the settings could not be read. One log entry identifies the setting and reason without including values or file contents: `Desktop server settings refused; using the local server.` Find it in `<userData>/logs/<launch timestamp>/main.log` (Beta on macOS: `~/Library/Application Support/ai.opencode.desktop.beta/logs/`). The fallback is cached; fix the file and relaunch Desktop to retry.

Settings and password files are read once per launch. File entries take precedence over UI entries at the same URL and are marked **From opencode.settings** in Settings > Servers. Edit those entries in the file. They are not copied into renderer persistence; removing one exposes any original UI entry again. Passwords stay in main-process memory and are attached only to requests from the app renderer to the exact configured origin (and to trusted extension requests for that server).

## Existing storage and startup

`src/main/service/background-service.ts` calls `Service.ensure` using the staged bundled CLI's `serve --service` command. `sidecar-probe.ts` performs early read-only discovery; `background-service-state.ts` shares the startup result. The renderer awaits it through `AppAwaitInitialization` and contributes a `sidecar` connection. The local credential stays in `SidecarCredentials` in main-process memory; `windows/security.ts` adds Authorization.

UI-added servers currently use renderer persistence: `state` table, namespace `opencode.global.dat`, key `server`, in `<userData>/drafts.sqlite`. The JSON value's `list[].http.password` stores existing UI passwords; there is no server Keychain integration. Home selection is in the same namespace's `layout` value (`home.selection.server`). Window routes/tabs are persisted separately. No active server-default key existed in `opencode.settings` before this change.

`lifecycle/index.ts` receives `open-url` and second-instance `opencode://` arguments, routes console authorization to its originating window using `lifecycle/deep-link.ts`, and forwards links through IPC. `renderer/startup/deep-links.ts` queues them on `window.__OPENCODE__.deepLinks` and dispatches `opencode:deep-link`. The app has no existing `--server` launch argument; preload reads only internal window bootstrap arguments. A new launch argument is omitted here to keep one authoritative configuration path and avoid differing first/second-instance behavior.
