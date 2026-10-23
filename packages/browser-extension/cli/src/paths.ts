// Where OpenCode Browser keeps its files: the installed runtime, the relay's log, session catalogs and
// journals, and captured secrets. One root, so `uninstall` can remove it and logs are easy to find.
//   macOS/Linux: $XDG_DATA_HOME/opencode-browser, else ~/.local/share/opencode-browser
//   Windows:     %LOCALAPPDATA%\opencode-browser
// OPENCODE_BROWSER_HOME overrides it (isolated test relays).
import os from "node:os"
import path from "node:path"

export function dataRoot(home = os.homedir()): string {
  const override = process.env.OPENCODE_BROWSER_HOME
  if (override) return override
  if (process.platform === "win32")
    return path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "opencode-browser")
  const xdg = home === os.homedir() ? process.env.XDG_DATA_HOME : undefined
  return path.join(xdg ?? path.join(home, ".local", "share"), "opencode-browser")
}
