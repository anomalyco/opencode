import fs from "fs"
import os from "os"
import path from "path"

process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"

// Direct `bun test` invocations bypass `packages/core/script/test.ts`.
// Isolate home and XDG roots before any module reads them.
if (!process.env.OPENCODE_TEST_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oc-"))
  const temporary = path.join(home, "tmp")
  fs.mkdirSync(temporary)

  process.env.HOME = home
  process.env.OPENCODE_TEST_HOME = home
  process.env.XDG_CONFIG_HOME = path.join(home, ".config")
  process.env.XDG_DATA_HOME = path.join(home, ".local", "share")
  process.env.XDG_CACHE_HOME = path.join(home, ".cache")
  process.env.XDG_STATE_HOME = path.join(home, ".local", "state")
  process.env.OPENCODE_CONFIG_DIR = path.join(home, ".config", "opencode")
  delete process.env.OPENCODE_CONFIG
  delete process.env.OPENCODE_CONFIG_CONTENT
  process.env.TMPDIR = temporary
  if (process.platform === "win32") {
    process.env.USERPROFILE = home
    process.env.TMP = temporary
    process.env.TEMP = temporary
  }

  process.once("exit", () => {
    try {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
    } catch {}
  })
}
