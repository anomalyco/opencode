export * as MoveSession from "./move-session"

import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { EventV2 } from "../event"
import { Git } from "../git"
import { Location } from "../location"
import { ProjectV2 } from "../project"
import { SessionV2 } from "../session"
import { SessionExecution } from "../session/execution"
import { SessionEvent } from "../session/event"
import { SessionSchema } from "../session/schema"
import { AbsolutePath, RelativePath } from "../schema"
import path from "path"

export const Destination = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "MoveSession.Destination" })
export type Destination = typeof Destination.Type

export const Input = Schema.Struct({
  sessionID: SessionSchema.ID,
  destination: Destination,
  moveChanges: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "MoveSession.Input" })
export type Input = typeof Input.Type

export class DestinationProjectMismatchError extends Schema.TaggedErrorClass<DestinationProjectMismatchError>()(
  "MoveSession.DestinationProjectMismatchError",
  {
    expected: ProjectV2.ID,
    actual: ProjectV2.ID,
  },
) {}

export class ApplyChangesError extends Schema.TaggedErrorClass<ApplyChangesError>()("MoveSession.ApplyChangesError", {
  message: Schema.String,
}) {}

export class CaptureChangesError extends Schema.TaggedErrorClass<CaptureChangesError>()(
  "MoveSession.CaptureChangesError",
  {
    message: Schema.String,
  },
) {}

export class ResetSourceChangesError extends Schema.TaggedErrorClass<ResetSourceChangesError>()(
  "MoveSession.ResetSourceChangesError",
  {
    directory: AbsolutePath,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type Error =
  | SessionV2.NotFoundError
  | DestinationProjectMismatchError
  | CaptureChangesError
  | ApplyChangesError
  | ResetSourceChangesError

export interface Interface {
  readonly moveSession: (input: Input) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ControlPlaneMoveSession") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const git = yield* Git.Service
    const events = yield* EventV2.Service
    const project = yield* ProjectV2.Service
    const session = yield* SessionV2.Service

    const moveSession = Effect.fn("MoveSession.moveSession")(function* (input: Input) {
      const current = yield* session.get(input.sessionID)
      const directory = AbsolutePath.make(input.destination.directory)
      if (current.location.directory === directory) return

      const source = yield* project.resolve(current.location.directory)
      const destination = yield* project.resolve(directory)
      if (current.projectID !== destination.id) {
        return yield* new DestinationProjectMismatchError({ expected: current.projectID, actual: destination.id })
      }

      const moveChanges = input.moveChanges && source.directory !== destination.directory
      const sourceRepository = moveChanges ? yield* git.repo.discover(current.location.directory) : undefined
      if (moveChanges && !sourceRepository)
        return yield* new CaptureChangesError({ message: "Source is not a Git repository" })
      const patch = sourceRepository
        ? yield* git.change
            .capture({ repository: sourceRepository, path: current.location.directory })
            .pipe(Effect.mapError((error) => new CaptureChangesError({ message: error.message })))
        : Git.ChangeSet.make("")
      if (patch) {
        const repository = yield* git.repo.discover(directory)
        if (!repository) return yield* new ApplyChangesError({ message: "Destination is not a Git repository" })
        yield* git.change
          .apply({ repository, path: directory, changes: patch })
          .pipe(Effect.mapError((error) => new ApplyChangesError({ message: error.message })))
      }

      yield* events.publish(SessionEvent.Moved, {
        sessionID: input.sessionID,
        location: Location.Ref.make({ directory }),
        subdirectory: RelativePath.make(path.relative(destination.directory, directory).replaceAll("\\", "/")),
        timestamp: yield* DateTime.now,
      })

      if (patch) {
        const repository = yield* git.repo.discover(current.location.directory)
        if (!repository)
          return yield* new ResetSourceChangesError({
            directory: current.location.directory,
            message: "Source is not a Git repository",
          })
        yield* git.change
          .discard({
            repository,
            path: current.location.directory,
            index: "preserve",
            untracked: "remove",
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new ResetSourceChangesError({
                  directory: current.location.directory,
                  message: error.message,
                  cause: error.cause,
                }),
            ),
          )
      }
    })

    return Service.of({ moveSession })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Git.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(ProjectV2.defaultLayer),
  Layer.provide(SessionExecution.noopLayer),
  Layer.provide(SessionV2.defaultLayer),
)
