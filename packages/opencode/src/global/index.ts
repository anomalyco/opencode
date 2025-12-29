import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

const app = "opencode"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

export namespace Global {
  export const Path = {
    home: os.homedir(),
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
  } as const
}

function ensureDir(dir: string) {
  return fs.mkdir(dir, { recursive: true }).catch((err) => {
    if (err.code === "EACCES") {
      const parent = path.dirname(dir)
      console.error(`
Error: Permission denied creating directory: ${dir}

The parent directory "${parent}" exists but opencode cannot write to it.
This can happen when another application created it with restrictive permissions.

To fix this, run:
  sudo chown -R $(whoami) ${parent}

Or set a custom data directory:
  export XDG_DATA_HOME=~/.opencode-data
`)
      process.exit(1)
    }
    throw err
  })
}

await Promise.all([
  ensureDir(Global.Path.data),
  ensureDir(Global.Path.config),
  ensureDir(Global.Path.state),
  ensureDir(Global.Path.log),
  ensureDir(Global.Path.bin),
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
