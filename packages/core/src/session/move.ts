export * as SessionMove from "./move.js"

import type { Session } from "@opencode/schema/session"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
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
  /**
   * Moves an idle session whose directory no longer exists (a removed worktree, say) to its
   * project's main checkout, so it stays usable. Does nothing when the directory exists or
   * no such checkout does.
   */
  readonly revive: (sessionID: Session.ID) => Effect.Effect<void>
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
          if (Cause.hasInterruptsOnly(cause))
            return Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
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
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
            : Effect.succeed(true),
        ),
      )
    })

    // Applies a move at once, dropping pending moves; callers hold the session's inbox lock.
    const relocate = Effect.fnUntraced(function* (sessionID: Session.ID, destination: SessionInbox.MovePayload) {
      const cancellations = (yield* SessionInbox.moveIDs(database.db, sessionID)).map(
        (item) => [SessionEvent.InboxCancelled, { sessionID, inboxID: item.id }] as const,
      )
      const moved = [SessionEvent.Moved, { sessionID, ...destination }] as const
      const first = cancellations[0]
      if (!first) return yield* bus.publish(...moved).pipe(Effect.asVoid)
      return yield* bus.publishAll([first, ...cancellations.slice(1), moved])
    })

    const samePlacement = (a: Session.Info, b: Session.Info) =>
      a.location.directory === b.location.directory && a.location.workspaceID === b.location.workspaceID

    // The project's main checkout, at the session's subdirectory when that still exists there.
    const mainCheckout = Effect.fnUntraced(function* (session: Session.Info) {
      if (session.projectID === Project.ID.global) return undefined
      const project = (yield* projects.list({ archived: true })).find((item) => item.id === session.projectID)
      if (!project?.vcs || project.canonical === session.location.directory) return undefined
      if (!(yield* fs.isDir(project.canonical))) return undefined
      if (!session.subpath) return project.canonical
      const nested = AbsolutePath.make(path.join(project.canonical, session.subpath))
      return (yield* fs.isDir(nested)) ? nested : project.canonical
    })

    const revive = Effect.fn("SessionMove.revive")(function* (sessionID: Session.ID) {
      const session = yield* store.get(sessionID)
      // Workspace placements can be remote; their directories aren't ours to probe.
      if (!session || session.location.workspaceID) return
      if (yield* fs.isDir(session.location.directory)) return
      if (yield* execution.isActive(sessionID)) return
      const directory = yield* mainCheckout(session)
      if (!directory) return
      const destination = yield* resolveDestination(session, { sessionID, directory }).pipe(
        Effect.catchTags({
          "Session.DestinationNotFoundError": () => Effect.void,
          "Session.DestinationNotDirectoryError": () => Effect.void,
          "Session.DestinationUnavailableError": () => Effect.void,
        }),
      )
      if (!destination) return
      const revived = yield* SessionInbox.serialized(
        sessionID,
        Effect.gen(function* () {
          const latest = yield* store.get(sessionID)
          if (!latest || !samePlacement(latest, session) || (yield* execution.isActive(sessionID))) return false
          yield* relocate(sessionID, destination)
          return true
        }),
      )
      if (revived) yield* Effect.logInfo("session revived in its project's main checkout", { sessionID })
    })

    return Service.of({
      revive,
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
            if (unavailable && samePlacement(latest, session) && !(yield* execution.isActive(input.sessionID)))
              return yield* relocate(input.sessionID, destination)
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
