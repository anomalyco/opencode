export * as InstructionBuiltIns from "./builtins.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import type { Session } from "@opencode-ai/schema/session"
import { Global } from "@opencode-ai/util/global"
import { Location } from "../location.js"
import { Config } from "../config.js"
import { ShellSelect } from "../shell/select.js"
import { Instructions } from "./index.js"

export interface Interface {
  readonly load: (sessionID: Session.ID) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstructionBuiltIns") {}

const customKey = Instructions.Key.make("core/custom-instructions")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const location = yield* Location.Service
    const config = yield* Config.Service
    const shellSelect = yield* ShellSelect.Service
    return Service.of({
      load: (sessionID) =>
        Effect.succeed(
          Instructions.combine([
            Instructions.make({
              key: Instructions.Key.make("core/environment"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.gen(function* () {
                const resolved = yield* shellSelect.resolve({ priority: "config" })
                return [
                  "<env>",
                  `  Current conversation session ID: ${sessionID}`,
                  `  Working directory: ${location.directory}`,
                  `  Workspace root folder: ${location.project.directory}`,
                  `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
                  `  Platform: ${process.platform}`,
                  `  OS: ${osLabel()}`,
                  `  Shell: ${ShellSelect.name(resolved)} (${resolved})`,
                  `  Prefer ${global.tmp} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
                  "</env>",
                ].join("\n")
              }),
              render: {
                initial: (environment) =>
                  ["Here is some useful information about the environment you are running in:", environment].join("\n"),
                changed: (_previous, environment) =>
                  ["The environment you are running in is now:", environment].join("\n"),
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("core/date"),
              codec: Schema.toCodecJson(Schema.String),
              read: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
              render: {
                initial: (date) => `Today's date: ${date}`,
                changed: (_previous, date) => `Today's date is now: ${date}`,
              },
            }),
            Instructions.make({
              key: customKey,
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.gen(function* () {
                const entries = yield* config.entries().pipe(Effect.orElseSucceed(() => []))
                const parts = entries.flatMap((entry) => {
                  const text = entry.type === "document" ? entry.info.customInstructions?.trim() : undefined
                  return text ? [text] : []
                })
                if (parts.length === 0) return Instructions.removed
                return parts.join("\n\n")
              }),
              render: {
                initial: renderCustom,
                changed: (_previous, current) => renderCustom(current),
                removed: () => "Previously loaded custom instructions no longer apply.",
              },
            }),
          ]),
        ),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Global.node, Location.node, Config.node, ShellSelect.node],
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

function renderCustom(text: string) {
  return [`<custom_instructions>`, text, `</custom_instructions>`].join("\n")
}
