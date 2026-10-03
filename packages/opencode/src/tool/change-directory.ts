import path from "path"
import { Effect, Schema } from "effect"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { SessionV2 } from "@opencode-ai/core/session"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Tool } from "./tool"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./change-directory.txt"

export const Parameters = Schema.Struct({
  directory: Schema.String.annotate({
    description: "The directory to switch to (absolute or relative to the current working directory)",
  }),
  moveChanges: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to move uncommitted changes to the destination directory. Defaults to false.",
  }),
})

type Metadata = {
  directory: string
}

export const ChangeDirectoryTool = Tool.define<typeof Parameters, Metadata, MoveSession.Service>(
  "change_directory",
  Effect.gen(function* () {
    const moveSession = yield* MoveSession.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "change_directory",
            patterns: [params.directory],
            always: [params.directory],
            metadata: { directory: params.directory },
          })

          const instance = yield* InstanceState.context
          const directory = AbsolutePath.make(
            path.isAbsolute(params.directory)
              ? params.directory
              : path.resolve(instance.directory, params.directory),
          )

          yield* moveSession
            .moveSession({
              sessionID: ctx.sessionID,
              destination: { directory },
              moveChanges: params.moveChanges ?? false,
            })
            .pipe(Effect.mapError((error) => new Error(describeError(error))))

          return {
            title: `Changed directory to ${directory}`,
            output: `Successfully changed working directory to ${directory}`,
            metadata: { directory },
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)

function describeError(error: MoveSession.Error): string {
  if (error instanceof SessionV2.NotFoundError) return `Session not found: ${error.sessionID}`
  if (error instanceof MoveSession.DestinationProjectMismatchError)
    return "Destination directory belongs to another project"
  if (error instanceof MoveSession.CaptureChangesError)
    return `Unable to capture changes in the source directory: ${error.message}`
  if (error instanceof MoveSession.ApplyChangesError)
    return `Unable to apply changes in the destination directory: ${error.message}`
  return `Unable to reset source changes in ${error.directory}: ${error.message}`
}
