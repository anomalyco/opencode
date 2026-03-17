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
 * Global application paths and initialization.
 *
 * Defines standard XDG-compliant paths for application data, configuration,
 * cache, and state directories. Automatically creates required directories
 * on module load and manages cache versioning.
 *
 * @example
 * ```typescript
 * const configPath = Global.Path.config
 * const dataPath = Global.Path.data
 * ```
 */
export namespace Global {
  /**
   * Standard application paths following XDG directory specifications.
   */
  export const Path = {
    /**
     * User home directory.
     * Can be overridden via OPENCODE_TEST_HOME environment variable for testing.
     */
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    /** Base directory for application data files. */
    data,
    /** Directory for executable binaries. */
    bin: path.join(data, "bin"),
    /** Directory for log files. */
    log: path.join(data, "log"),
    /** Base directory for cached files. */
    cache,
    /** Base directory for configuration files. */
    config,
    /** Base directory for state files (runtime data). */
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
