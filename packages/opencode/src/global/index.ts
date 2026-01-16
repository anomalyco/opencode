import fs from "fs/promises"
import { existsSync } from "fs"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

// Conatus: Named after Spinoza's concept of striving to persist in one's being
// Backward compatible with opencode directories
const APP_NAME = "conatus"
const LEGACY_APP_NAME = "opencode"

// Check if legacy directories exist and prefer them for backward compatibility
// New installations will use "conatus" directories
function resolveAppDir(xdgBase: string | undefined): string {
  const legacyPath = path.join(xdgBase!, LEGACY_APP_NAME)
  const newPath = path.join(xdgBase!, APP_NAME)
  // Prefer existing legacy dirs for backward compatibility
  if (existsSync(legacyPath) && !existsSync(newPath)) {
    return legacyPath
  }
  return existsSync(newPath) ? newPath : legacyPath // Default to legacy for now
}

const data = resolveAppDir(xdgData)
const cache = resolveAppDir(xdgCache)
const config = resolveAppDir(xdgConfig)
const state = resolveAppDir(xdgState)

export namespace Global {
  export const Path = {
    // Allow override via OPENCODE_TEST_HOME for test isolation
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
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

const CACHE_VERSION = "18"

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
