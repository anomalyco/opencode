export * as SessionSystemContext from "./session-system-context"

import { Context, DateTime, Effect, Layer } from "effect"
import { Location } from "./location"
import { SystemContext } from "./system-context"

export interface Interface {
  readonly load: () => Effect.Effect<SystemContext.Snapshot>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionSystemContext") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const environment = [
      "<env>",
      `  Working directory: ${location.directory}`,
      `  Workspace root folder: ${location.project.directory}`,
      `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      "</env>",
    ].join("\n")
    const context = SystemContext.struct({
      environment: SystemContext.value({
        key: SystemContext.Key.make("core/environment"),
        load: Effect.succeed({
          baseline: ["Here is some useful information about the environment you are running in:", environment].join(
            "\n",
          ),
          update: ["The environment you are running in is now:", environment].join("\n"),
        }),
      }),
      date: SystemContext.value({
        key: SystemContext.Key.make("core/date"),
        load: DateTime.nowAsDate.pipe(
          Effect.map((date) => ({
            baseline: `Today's date: ${date.toDateString()}`,
            update: `Today's date is now: ${date.toDateString()}`,
          })),
        ),
      }),
    })

    return Service.of({
      load: Effect.fn("SessionSystemContext.load")(function* () {
        return yield* SystemContext.load(context)
      }),
    })
  }),
)

export const locationLayer = layer
