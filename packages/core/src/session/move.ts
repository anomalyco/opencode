export * as SessionMove from "./move.js"

import type { Session } from "@opencode-ai/schema/session"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Cause, Effect, Schema } from "effect"
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

export const prepare = Effect.fn("SessionMove.prepare")(function* (input: {
  session: Session.Info
  directory: AbsolutePath
  workspaceID?: Location.Ref["workspaceID"]
}) {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const projects = yield* Project.Service
  const locations = yield* LocationServiceMap.Service
  const value = input.directory.trim()
  const expanded = value === "~" ? global.home : value.startsWith("~/") ? path.join(global.home, value.slice(2)) : value
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
})
