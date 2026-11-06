import path from "path"
import fs from "fs"
import os from "os"
import { Context, Effect, Layer } from "effect"
// XDG on runtimes with a home directory; one tmp-rooted directory on workerd.
// The variants resolve through the `workerd` bundle condition, like the
// native-module stubs, so no runtime sniffing happens here.
import { roots } from "#global-roots"
import { Flock } from "./flock.js"
import { makeGlobalNode } from "./effect/app-node.js"

const app = "opencode"
const { data, cache, config, state, tmp } = roots(app)

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
  /** Global config directories in priority order, primary first; equals `[config]` unless `configDirectory` adds one. */
  readonly configDirs: readonly string[]
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

/**
 * Global config locations for a configured directory: when it is the `OPENCODE_CONFIG_DIR` override, the
 * XDG default stays active underneath it (opencode#28658, opencode#32825) — the override wins file lookups
 * and config merges, but never replaces the default layer. Any other explicit directory (tests, embedded
 * hosts) replaces it exactly as before.
 */
export const configDirectory = (value: string | undefined): Partial<Interface> =>
  value && value === process.env.OPENCODE_CONFIG_DIR
    ? { config: value, configDirs: [...new Set([value, Path.config])] }
    : value
      ? { config: value }
      : {}

export function make(input: Partial<Interface> = {}): Interface {
  // The acquired service canonicalizes default tmp; use it instead of Path.tmp for path comparisons.
  const config = input.config ?? input.configDirs?.[0] ?? Path.config
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config,
    configDirs: input.configDirs ?? [config],
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
  Effect.suspend(() => acquire(configDirectory(process.env.OPENCODE_CONFIG_DIR))),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) => Layer.effect(Service, acquire(input))

export * as Global from "./global.js"
