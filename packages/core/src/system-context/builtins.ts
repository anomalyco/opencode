export * as SystemContextBuiltIns from "./builtins"

import { makeLocationNode } from "../effect/app-node"
import { DateTime, Effect, Layer, Option, Schema } from "effect"
import { Location } from "../location"
import { SystemContext } from "./index"
import { InstructionContext } from "../instruction-context"
import { SystemContextRegistry } from "./registry"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Config } from "../config"
import { Shell } from "../shell"

const builtIns = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    const loadEnvironment = Effect.fn("SystemContextBuiltIns.environment")(function* () {
      const config = yield* Effect.serviceOption(Config.Service)
      const configured = Option.isNone(config)
        ? undefined
        : Config.latest(
            yield* config.value.entries().pipe(Effect.catch(() => Effect.succeed([] as Config.Entry[]))),
            "shell",
          )
      const resolved = Shell.preferred(configured)
      return [
        "<env>",
        `  Working directory: ${location.directory}`,
        `  Workspace root folder: ${location.project.directory}`,
        `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  OS: ${osLabel()}`,
        `  Shell: ${Shell.name(resolved)} (${resolved})`,
        "</env>",
      ].join("\n")
    })
    const context = SystemContext.combine([
      SystemContext.make({
        key: SystemContext.Key.make("core/environment"),
        codec: Schema.toCodecJson(Schema.String),
        load: loadEnvironment(),
        baseline: (environment) =>
          ["Here is some useful information about the environment you are running in:", environment].join("\n"),
        update: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        load: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
        baseline: (date) => `Today's date: ${date}`,
        update: (_previous, date) => `Today's date is now: ${date}`,
      }),
    ])

    yield* registry.register({ key: SystemContext.Key.make("core/builtins"), load: Effect.succeed(context) })
  }),
)

export const node = makeLocationNode({
  name: "system-context-builtins",
  layer: builtIns,
  deps: [Location.node, SystemContextRegistry.node, InstructionContext.node, FSUtil.node, Global.node],
})

const OS_NAMES: Record<string, string> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  sunos: "SunOS",
  aix: "AIX",
}

function osLabel(platform = process.platform, arch = process.arch) {
  return `${OS_NAMES[platform] ?? platform} (${arch})`
}
