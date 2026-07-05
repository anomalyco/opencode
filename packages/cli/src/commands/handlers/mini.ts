import { Effect, Option, Redacted } from "effect"
import path from "node:path"
import { Commands } from "../commands"
import { Env } from "../../env"
import { Runtime } from "../../framework/runtime"

export default Runtime.handler(Commands.commands.mini, (input) =>
  Effect.gen(function* () {
    const { runMini } = yield* Effect.promise(() => import("../../mini"))
    const project = Option.getOrUndefined(input.project)
    const server = Option.getOrUndefined(input.server)
    const password = yield* Env.password
    yield* Effect.promise(() =>
      runMini({
        attach: server,
        password: password ? Redacted.value(password) : undefined,
        directory:
          server !== undefined
            ? project
            : project === undefined
              ? process.cwd()
              : path.resolve(process.env.PWD ?? process.cwd(), project),
        continue: input.continue,
        session: Option.getOrUndefined(input.session),
        fork: input.fork,
        model: Option.getOrUndefined(input.model),
        agent: Option.getOrUndefined(input.agent),
        prompt: Option.getOrUndefined(input.prompt),
        replay: input.replay,
        replayLimit: Option.getOrUndefined(input.replayLimit),
        demo: input.demo,
      }),
    )
  }),
)
