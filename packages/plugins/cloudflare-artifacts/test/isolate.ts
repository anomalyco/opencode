import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// The live tests run outside core's test runner, which drops Cloudflare credentials, so they get its isolated home here.
const home = mkdtempSync(path.join(tmpdir(), "opencode-cloudflare-live-"))
Object.assign(process.env, {
  HOME: home,
  OPENCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  XDG_STATE_HOME: path.join(home, ".local", "state"),
  OPENCODE_CONFIG_DIR: path.join(home, ".config", "opencode"),
})
