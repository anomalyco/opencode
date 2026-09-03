export * as SessionMove from "./move.js"

import type { Session } from "@opencode-ai/schema/session"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Cause, Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { Location } from "../location.js"
import { LocationServiceMap } from "../location-service-map.js"
import { Project } from "../project.js"
import { AbsolutePath, RelativePath } from "../schema.js"

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
  readonly prepare: (input: {
    session: Session.Info
    directory: AbsolutePath
    workspaceID?: Location.Ref["workspaceID"]
  }) => Effect.Effect<
    SessionInbox.MovePayload,
    DestinationNotFoundError | DestinationNotDirectoryError | DestinationUnavailableError
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

    return Service.of({
      prepare: Effect.fn("SessionMove.prepare")(function* (input) {
        const value = input.directory.trim()
        const expanded =
          value === "~" ? global.home : value.startsWith("~/") ? path.join(global.home, value.slice(2)) : value
        const directory = AbsolutePath.make(path.resolve(input.session.location.directory, expanded))
        const info = yield* fs.stat(directory).pipe(Effect.orElseSucceed(() => undefined))
        if (!info) return yield* new DestinationNotFoundError({ directory })
        if (info.type !== "Directory") return yield* new DestinationNotDirectoryError({ directory })
        const project = yield* projects.resolve(directory)
        const payload: SessionInbox.MovePayload = {
          location: Location.Ref.make({ directory, workspaceID: input.workspaceID }),
          projectID: project.id,
          subpath: RelativePath.make(path.relative(project.directory, directory).replaceAll("\\", "/")),
        }
        yield* Location.Service.pipe(
          Effect.provide(locations.get(payload.location)),
          Effect.scoped,
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
            return Effect.logWarning("session move destination unavailable", { directory, cause }).pipe(
              Effect.andThen(Effect.fail(new DestinationUnavailableError({ directory }))),
            )
          }),
        )
        return payload
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Project.node, LocationServiceMap.node],
})
