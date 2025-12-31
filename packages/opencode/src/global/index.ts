import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

const app = "opencode"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

async function isDirectory(p: string): Promise<boolean> {
  const stat = await fs.stat(p).catch(() => undefined)
  return stat?.isDirectory() ?? false
}

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

  /**
   * Returns the Claude config directory path using this priority:
   * 1. CLAUDE_CONFIG_DIR environment variable (if set and is a directory)
   * 2. ~/.config/claude (new default, if it exists as a directory)
   * 3. ~/.claude (legacy, if it exists as a directory)
   * 4. undefined if none exist
   */
  export async function claudeConfigDir(): Promise<string | undefined> {
    // Check CLAUDE_CONFIG_DIR env var at runtime (not cached in Flag namespace)
    const claudeEnvDir = process.env.CLAUDE_CONFIG_DIR
    if (claudeEnvDir && (await isDirectory(claudeEnvDir))) {
      return claudeEnvDir
    }

    // Check XDG path (~/.config/claude or XDG_CONFIG_HOME/claude)
    // Read XDG_CONFIG_HOME at runtime to support test isolation
    const xdgConfigPath = process.env.XDG_CONFIG_HOME || path.join(Path.home, ".config")
    const xdgClaude = path.join(xdgConfigPath, "claude")
    if (await isDirectory(xdgClaude)) {
      return xdgClaude
    }

    // Check legacy path (~/.claude)
    const legacyClaude = path.join(Path.home, ".claude")
    if (await isDirectory(legacyClaude)) {
      return legacyClaude
    }

    return undefined
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "14"

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
