import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Flag } from "../flag/flag"
import { Filesystem } from "../util/filesystem"

// Path precedence:
// 1. Explicit path overrides (OPENCODE_*_DIR) take highest priority
// 2. OPENCODE_APPNAME-derived paths (e.g., ~/.local/share/opencode-work)
// 3. Default XDG paths with "opencode" as app name
//
// Example: Profile isolation for separate OAuth identities
//   OPENCODE_APPNAME=opencode-work opencode    # Work profile
//   OPENCODE_APPNAME=opencode-personal opencode # Personal profile
const app = Flag.OPENCODE_APPNAME || "opencode"

const data = Flag.OPENCODE_DATA_DIR || path.join(xdgData!, app)
const cache = Flag.OPENCODE_CACHE_DIR || path.join(xdgCache!, app)
const log = Flag.OPENCODE_LOG_DIR || path.join(data, "log")
const config = path.join(xdgConfig!, app)
const state = Flag.OPENCODE_STATE_DIR || path.join(xdgState!, app)

export namespace Global {
  export const Path = {
    // Allow override via OPENCODE_TEST_HOME for test isolation
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    data,
    bin: path.join(cache, "bin"),
    log,
    cache,
    config,
    state,
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
