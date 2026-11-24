export * as InstructionBuiltIns from "./builtins.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { Instructions } from "./index.js"

/** A session's working directory as the model writes it, when one is set. */
export interface Cwd {
  /** A path on this server, or `machine:/path` for a paired machine. */
  readonly path: string
  /** The machine holding the directory, when it is not this server. */
  readonly machine?: string
}

export interface Interface {
  /** Loads the built-in instructions, with the session's working directory when it has one. */
  readonly load: (input?: { readonly cwd?: Cwd }) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstructionBuiltIns") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const location = yield* Location.Service
    return Service.of({
      load: (input) =>
        Effect.succeed(
          Instructions.combine([
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
              key: Instructions.Key.make("core/environment"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() =>
                environment(input?.cwd, {
                  directory: location.directory,
                  projectDirectory: location.project.directory,
                  git: location.vcs?.type === "git" ? "yes" : "no",
                  platform: process.platform,
                  temporary: global.tmp,
                }),
              ),
              render: {
                initial: (environment) =>
                  ["Here is some useful information about the environment you are running in:", environment].join("\n"),
                changed: (_previous, environment) =>
                  ["The environment you are running in is now:", environment].join("\n"),
              },
            }),
          ]),
        ),
    })
  }),
)

/**
 * The environment block. A cwd on a paired machine is a different computer, so this server's
 * workspace, repository and platform are left out rather than claimed for it.
 */
function environment(
  cwd: Cwd | undefined,
  local: {
    readonly directory: string
    readonly projectDirectory: string
    readonly git: string
    readonly platform: string
    readonly temporary: string
  },
) {
  if (!cwd || (cwd.machine === undefined && cwd.path === local.directory))
    return box([
      `  Working directory: ${local.directory}`,
      `  Workspace root folder: ${local.projectDirectory}`,
      `  Is directory a git repo: ${local.git}`,
      `  Platform: ${local.platform}`,
      preferTemporary(local.temporary),
    ])
  if (cwd.machine)
    return box([
      `  Working directory: ${cwd.path}`,
      `  Machine: ${cwd.machine}`,
      `  Commands and relative paths run on ${cwd.machine}, not on this server.`,
    ])
  return box([`  Working directory: ${cwd.path}`, `  Platform: ${local.platform}`, preferTemporary(local.temporary)])
}

const box = (lines: ReadonlyArray<string>) => ["<env>", ...lines, "</env>"].join("\n")

const preferTemporary = (path: string) =>
  `  Prefer ${path} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`

export const node = makeLocationNode({ service: Service, layer, deps: [Global.node, Location.node] })
