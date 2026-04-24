import path from "path"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"

export namespace Global {
  export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

  export interface Interface {
    readonly home: string
    readonly data: string
    readonly cache: string
    readonly config: string
    readonly state: string
    readonly bin: string
    readonly log: string
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const app = "opencode"
      const home = process.env.OPENCODE_TEST_HOME ?? os.homedir()
      const data = path.join(xdgData!, app)
      const cache = path.join(xdgCache!, app)
      const cfg = path.join(xdgConfig!, app)
      const state = path.join(xdgState!, app)
      const bin = path.join(cache, "bin")
      const log = path.join(data, "log")

      return Service.of({
        home,
        data,
        cache,
        config: cfg,
        state,
        bin,
        log,
      })
    }),
  )
}
