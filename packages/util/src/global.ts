import path from "path"
import fs from "fs"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./flock.js"
import { makeGlobalNode } from "./effect/app-node.js"

const app = "opencode"
const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)
const tmp = path.join(os.tmpdir(), app)

const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? os.homedir()
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
  // The acquired service canonicalizes default tmp; use it instead of Path.tmp for path comparisons.
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Path.config,
    state: Path.state,
    tmp: input.tmp ?? Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

const acquire = (input: Partial<Interface>) =>
  Effect.gen(function* () {
    const service = Service.of(make(input))
    yield* Effect.promise(() =>
      Promise.all(
        [service.data, service.config, service.state, service.log, service.bin, service.repos, service.tmp].map(
          (directory) => fs.promises.mkdir(directory, { recursive: true }),
        ),
      ),
    )
    const canonicalTmp = yield* Effect.promise(() => fs.promises.realpath(service.tmp))
    return Service.of({ ...service, tmp: input.tmp ?? canonicalTmp })
  })

const layer = Layer.effect(
  Service,
  Effect.suspend(() => acquire({ config: process.env.OPENCODE_CONFIG_DIR ?? Path.config })),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) => Layer.effect(Service, acquire(input))

export * as Global from "./global.js"
