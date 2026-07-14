import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag, envAlias } from "./flag/flag"
import { makeGlobalNode } from "./effect/app-node"

/** Prefer nonempty kancode XDG dir; else fall back to legacy opencode (data/cache/state/tmp). */
function pickAppDir(base: string) {
  const preferred = path.join(base, "kancode")
  const legacy = path.join(base, "opencode")
  if (fsSync.existsSync(preferred)) {
    try {
      if (fsSync.readdirSync(preferred).length > 0) return preferred
    } catch {
      // fall through
    }
  }
  if (fsSync.existsSync(legacy)) return legacy
  return preferred
}

const data = pickAppDir(xdgData!)
const cache = pickAppDir(xdgCache!)
// User-scope config XDG: KanCode only — never fall back to ~/.config/opencode.
const config = path.join(xdgConfig!, "kancode")
const state = pickAppDir(xdgState!)
const tmp = (() => {
  const preferred = path.join(os.tmpdir(), "kancode")
  const legacy = path.join(os.tmpdir(), "opencode")
  if (fsSync.existsSync(preferred)) {
    try {
      if (fsSync.readdirSync(preferred).length > 0) return preferred
    } catch {
      // fall through
    }
  }
  if (fsSync.existsSync(legacy)) return legacy
  return preferred
})()

const paths = {
  get home() {
    return envAlias("TEST_HOME") ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.tmp, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
  fs.mkdir(Path.repos, { recursive: true }),
])

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.OPENCODE_CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"
