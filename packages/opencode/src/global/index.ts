import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

const app = "opencode"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

/**
 * Global paths and initialization namespace.
 *
 * Manages XDG-compliant directory paths for data, cache, config, and state.
 * Automatically creates required directories and handles cache versioning.
 *
 * @example
 * ```typescript
 * const dataPath = Global.Path.data
 * const configPath = Global.Path.config
 * ```
 */
export namespace Global {
  /**
   * XDG-compliant paths for opencode application data.
   *
   * All paths follow the XDG Base Directory Specification.
   * The home path can be overridden via OPENCODE_TEST_HOME for testing.
   */
  export const Path = {
    /** User home directory (or OPENCODE_TEST_HOME override for tests) */
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    /** Data directory for persistent application data */
    data,
    /** Binary directory within data */
    bin: path.join(data, "bin"),
    /** Log directory within data */
    log: path.join(data, "log"),
    /** Cache directory for temporary data */
    cache,
    /** Config directory for configuration files */
    config,
    /** State directory for runtime state */
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
