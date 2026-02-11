import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

const app = "opencode"

// Allow tests to override XDG paths
let configOverride: string | undefined

function getXdgDir(xdgValue: string | undefined, xdgFallback: string, override?: string) {
  // Prefer explicit override for test isolation
  if (override) return override
  // Then prefer explicit XDG env var
  if (xdgValue) return path.join(xdgValue, app)
  // Fall back to test home
  const home = process.env.OPENCODE_TEST_HOME || os.homedir()
  return path.join(home, xdgFallback, app)
}

export namespace Global {
  export const Path = {
    // Allow override via OPENCODE_TEST_HOME for test isolation
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    get data() {
      return getXdgDir(xdgData, ".local/share")
    },
    get bin() {
      return path.join(this.data, "bin")
    },
    get log() {
      return path.join(this.data, "log")
    },
    get cache() {
      return getXdgDir(xdgCache, ".cache")
    },
    get config() {
      return getXdgDir(xdgConfig, ".config", configOverride)
    },
    set config(value: string) {
      configOverride = value
    },
    get state() {
      return getXdgDir(xdgState, ".local/state")
    },
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

const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

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
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}
