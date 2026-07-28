export * as MoveSession from "./move-session"

import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Git } from "../git"
import { Global } from "@opencode-ai/util/global"
import { Project } from "../project"
import { Session } from "../session"
import { SessionExecution } from "../session/execution"
import { SessionSchema } from "../session/schema"
import { SessionStore } from "../session/store"
import { AbsolutePath } from "../schema"
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
    expected: Project.ID,
    actual: Project.ID,
  },
) {}

export class DestinationNotFoundError extends Schema.TaggedErrorClass<DestinationNotFoundError>()(
  "MoveSession.DestinationNotFoundError",
  { directory: AbsolutePath },
) {}

export class DestinationNotDirectoryError extends Schema.TaggedErrorClass<DestinationNotDirectoryError>()(
  "MoveSession.DestinationNotDirectoryError",
  { directory: AbsolutePath },
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
  | Session.NotFoundError
  | DestinationProjectMismatchError
  | DestinationNotFoundError
  | DestinationNotDirectoryError
  | Session.DestinationNotFoundError
  | Session.DestinationNotDirectoryError
  | CaptureChangesError
  | ApplyChangesError
  | ResetSourceChangesError

export interface Interface {
  readonly moveSession: (input: Input) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ControlPlaneMoveSession") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const git = yield* Git.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const project = yield* Project.Service
    const sessions = yield* SessionStore.Service
    const session = yield* Session.Service
    const execution = yield* SessionExecution.Service

    const moveSession = Effect.fn("MoveSession.moveSession")(function* (input: Input) {
      const current = yield* sessions.get(input.sessionID)
      if (!current) return yield* new Session.NotFoundError({ sessionID: input.sessionID })
      const value = input.destination.directory.trim()
      const expanded = value === "~" ? global.home : value.startsWith("~/") ? path.join(global.home, value.slice(2)) : value
      const directory = AbsolutePath.make(path.resolve(current.location.directory, expanded))
      const destinationInfo = yield* fs.stat(directory).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!destinationInfo) return yield* new DestinationNotFoundError({ directory })
      if (destinationInfo.type !== "Directory") return yield* new DestinationNotDirectoryError({ directory })
      if (current.location.directory === directory) return

      const source = yield* project.resolve(current.location.directory)
      const destination = yield* project.resolve(directory)
      if (input.moveChanges && current.projectID !== destination.id) {
        return yield* new DestinationProjectMismatchError({ expected: current.projectID, actual: destination.id })
      }
      // A move must not race active execution: a mid-drain relocation would let
      // the source Location dispatch a request assembled under stale instructions
      // and history. Serialize like removal does — stop the drain, then move.
      yield* execution.interrupt(input.sessionID)
      yield* execution.awaitIdle(input.sessionID)

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

      yield* session.move({
        sessionID: input.sessionID,
        directory,
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

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    FSUtil.node,
    Git.node,
    Global.node,
    Project.node,
    Session.node,
    SessionStore.node,
    SessionExecution.node,
  ],
})
