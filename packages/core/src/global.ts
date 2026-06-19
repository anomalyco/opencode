import path from "path"
import fs from "fs/promises"
import { mkdirSync } from "fs"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"
import { LayerNode } from "./effect/layer-node"

const app = "opencode"
const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)
const tmp = path.join(os.tmpdir(), app)

const defaultPaths = {
  home: process.env.OPENCODE_TEST_HOME ?? os.homedir(),
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

function resolveAppPaths() {
  const name = Flag.OPENCODE_APP_NAME
  if (name) {
    const d = path.join(xdgData!, name)
    const c = path.join(xdgCache!, name)
    const s = path.join(xdgState!, name)
    return {
      home: defaultPaths.home,
      data: d,
      bin: path.join(c, "bin"),
      log: path.join(d, "log"),
      repos: path.join(d, "repos"),
      cache: c,
      config: Flag.OPENCODE_CONFIG_DIR ?? path.join(xdgConfig!, name),
      state: s,
      tmp: path.join(os.tmpdir(), name),
    }
  }
  return {
    ...defaultPaths,
    config: Flag.OPENCODE_CONFIG_DIR ?? defaultPaths.config,
  }
}

export const Path: typeof defaultPaths = new Proxy(defaultPaths, {
  get(target, prop, receiver) {
    const resolved = resolveAppPaths()
    return Reflect.get(resolved, prop, receiver)
  },
})

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

function appDir(base: string, sub?: string) {
  const name = Flag.OPENCODE_APP_NAME ?? "opencode"
  const dir = path.join(base, name)
  return sub ? path.join(dir, sub) : dir
}

export function make(input: Partial<Interface> = {}): Interface {
  const name = Flag.OPENCODE_APP_NAME
  if (name) {
    const d = appDir(xdgData!)
    const c = appDir(xdgCache!)
    const s = appDir(xdgState!)
    const t = path.join(os.tmpdir(), name)
    const dirs = [d, c, s, t, path.join(c, "bin"), path.join(d, "log"), path.join(d, "repos")]
    for (const dir of dirs) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch {}
    }
    return {
      home: Path.home,
      data: d,
      cache: c,
      config: Flag.OPENCODE_CONFIG_DIR ?? appDir(xdgConfig!),
      state: s,
      tmp: t,
      bin: path.join(c, "bin"),
      log: path.join(d, "log"),
      repos: path.join(d, "repos"),
      ...input,
    }
  }
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

export const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const defaultLayer = layer
export const node = LayerNode.make(layer, [])

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"
