export * as Formatter from "./formatter.js"

import { Context, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import path from "path"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { AppProcess } from "@opencode-ai/util/process"
import { Location } from "./location.js"
import type { Info } from "./formatter/builtins.js"
import { State } from "./state.js"

type Data = {
  formatters: Info[]
}

export type Draft = {
  set: (formatter: Info) => void
  remove: (name: string) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly file: (filepath: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Formatter") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const commands = new WeakMap<Info, string[] | false>()
    const state = State.create<Data, Draft>({
      name: "formatter",
      initial: () => ({ formatters: [] }),
      draft: (draft) => ({
        set: (formatter) => {
          const index = draft.formatters.findIndex((item) => item.name === formatter.name)
          if (index === -1) draft.formatters.push(formatter)
          else draft.formatters[index] = formatter
        },
        remove: (name) => {
          draft.formatters = draft.formatters.filter((formatter) => formatter.name !== name)
        },
      }),
    })

    const command = Effect.fnUntraced(function* (formatter: Info) {
      const cached = commands.get(formatter)
      if (cached !== undefined) return cached
      const result = yield* formatter.enabled
      if (result !== false) commands.set(formatter, result)
      return result
    })

    const file = Effect.fn("Formatter.file")(function* (filepath: string) {
      const matching = state
        .get()
        .formatters.filter((formatter) => formatter.extensions.includes(path.extname(filepath)))

      for (const formatter of matching) {
        const enabled = yield* command(formatter)
        if (enabled === false) continue
        const cmd = enabled.map((argument) => argument.replace("$FILE", filepath))
        yield* Effect.logInfo("formatting file", { file: filepath, command: cmd })
        const result = yield* processes
          .run(
            ChildProcess.make(cmd[0], cmd.slice(1), {
              cwd: location.directory,
              env: formatter.environment,
              extendEnv: true,
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
            }),
          )
          .pipe(
            Effect.catch((error) =>
              Effect.logError("failed to format file", {
                file: filepath,
                command: cmd,
                error: error.message,
              }).pipe(Effect.as(undefined)),
            ),
          )
        if (!result) continue
        if (result.exitCode === 0) return true
        yield* Effect.logError("formatter exited unsuccessfully", {
          file: filepath,
          command: cmd,
          exitCode: result.exitCode,
        })
      }
      return false
    })

    return Service.of({ transform: state.transform, reload: state.reload, file })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, AppProcess.node],
})
