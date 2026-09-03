export * as SessionMove from "./move.js"

import type { Session } from "@opencode-ai/schema/session"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Cause, Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Instance } from "../instance/service.js"
import { Location } from "../location.js"
import { LocationServiceMap } from "../location-service-map.js"
import { Project } from "../project.js"
import { AbsolutePath, RelativePath } from "../schema.js"
import { NotFoundError } from "./error.js"
import { SessionEvent } from "./event.js"
import { SessionExecution } from "./execution.js"
import { SessionInbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { SessionProjector } from "./projector.js"
import { SessionRunner } from "./runner/index.js"
import { SessionStore } from "./store.js"

export class DestinationNotFoundError extends Schema.TaggedError<DestinationNotFoundError>()(
  "Session.DestinationNotFoundError",
  { directory: AbsolutePath },
) {}

export class DestinationNotDirectoryError extends Schema.TaggedError<DestinationNotDirectoryError>()(
  "Session.DestinationNotDirectoryError",
  { directory: AbsolutePath },
) {}

export class DestinationUnavailableError extends Schema.TaggedError<DestinationUnavailableError>()(
  "Session.DestinationUnavailableError",
  { directory: AbsolutePath },
) {}

export interface Interface {
  readonly move: (input: {
    sessionID: Session.ID
    directory: AbsolutePath
    workspaceID?: Location.Ref["workspaceID"]
    delivery?: SessionInbox.Delivery
  }) => Effect.Effect<
    void,
    NotFoundError | DestinationNotFoundError | DestinationNotDirectoryError | DestinationUnavailableError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionMove") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const projects = yield* Project.Service
    const locations = yield* LocationServiceMap.Service
    const store = yield* SessionStore.Service
    const execution = yield* SessionExecution.Service
    const instances = yield* Instance.Service
    const admission = yield* SessionInbox.Service
    const database = yield* Database.Service
    const bus = yield* Bus.Service

    const get = Effect.fn("SessionMove.get")(function* (sessionID: Session.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* new NotFoundError({ sessionID })
      return session
    })

    const resolveDestination = Effect.fn("SessionMove.resolveDestination")(function* (
      session: Session.Info,
      input: Parameters<Interface["move"]>[0],
    ) {
      const value = input.directory.trim()
      const expanded =
        value === "~" ? global.home : value.startsWith("~/") ? path.join(global.home, value.slice(2)) : value
      const directory = AbsolutePath.make(path.resolve(session.location.directory, expanded))
      const info = yield* fs.stat(directory).pipe(Effect.orElseSucceed(() => undefined))
      if (!info) return yield* new DestinationNotFoundError({ directory })
      if (info.type !== "Directory") return yield* new DestinationNotDirectoryError({ directory })
      const project = yield* projects.resolve(directory)
      const destination: SessionInbox.MovePayload = {
        location: Location.Ref.make({ directory, workspaceID: input.workspaceID }),
        projectID: project.id,
        subpath: RelativePath.make(path.relative(project.directory, directory).replaceAll("\\", "/")),
      }
      yield* locations.contextEffect(destination.location).pipe(
        Effect.scoped,
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
          return Effect.logWarning("session move destination unavailable", { directory, cause }).pipe(
            Effect.andThen(Effect.fail(new DestinationUnavailableError({ directory }))),
          )
        }),
      )
      return destination
    })

    const sourceUnavailable = Effect.fn("SessionMove.sourceUnavailable")(function* (session: Session.Info) {
      if (yield* execution.isActive(session.id)) return false
      if (!(yield* fs.isDir(session.location.directory))) return true
      return yield* SessionRunner.Service.pipe(
        instances.provide(session),
        Effect.as(false),
        Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.succeed(true))),
      )
    })

    return Service.of({
      move: Effect.fn("SessionMove.move")(function* (input) {
        const session = yield* get(input.sessionID)
        const destination = yield* resolveDestination(session, input)
        // Probe outside the inbox lock so cancellation remains available during initialization.
        const unavailable = yield* sourceUnavailable(session)
        const item = SessionInbox.Item.make({
          type: "move",
          payload: destination,
          delivery: input.delivery ?? "steer",
        })
        yield* SessionInbox.serialized(
          input.sessionID,
          Effect.gen(function* () {
            const latest = yield* get(input.sessionID)
            // Only recover the placement we probed; active runners retain their step-boundary handoff.
            if (
              unavailable &&
              latest.location.directory === session.location.directory &&
              latest.location.workspaceID === session.location.workspaceID &&
              !(yield* execution.isActive(input.sessionID))
            ) {
              const cancellations = (yield* SessionInbox.moveIDs(database.db, input.sessionID)).map(
                (item) => [SessionEvent.InboxCancelled, { sessionID: input.sessionID, inboxID: item.id }] as const,
              )
              const moved = [SessionEvent.Moved, { sessionID: input.sessionID, ...destination }] as const
              const first = cancellations[0]
              if (!first) return yield* bus.publish(...moved).pipe(Effect.asVoid)
              return yield* bus.publishAll([first, ...cancellations.slice(1), moved])
            }
            yield* admission
              .admit({
                id: SessionMessage.ID.create(),
                sessionID: input.sessionID,
                item,
              })
              .pipe(Effect.orDie)
          }),
        )
        yield* execution.wake(input.sessionID)
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    FSUtil.node,
    Global.node,
    Project.node,
    LocationServiceMap.node,
    SessionStore.node,
    SessionExecution.node,
    Instance.node,
    SessionInbox.node,
    Database.node,
    Bus.node,
    SessionProjector.node,
  ],
})
