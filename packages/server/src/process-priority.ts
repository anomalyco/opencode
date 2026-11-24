export * as ProcessPriority from "./process-priority"

import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { constants, setPriority } from "node:os"

/**
 * Runs this process above normal priority on Windows, and returns whether it did. It does nothing elsewhere.
 *
 * Windows gives a processor to the thread of the higher priority class first. The builds, tests and browsers that
 * agents start run at normal priority, as the server did. On a busy machine they kept the thread that answers every
 * request waiting for a processor: in a three-minute sample it was ready to run and waiting for half of the time, and
 * running for a sixth. A process started from this one does not inherit a class above normal, so git and the agents'
 * commands stay at normal priority.
 */
export function raise() {
  if (process.platform !== "win32") return false
  setPriority(constants.priority.PRIORITY_ABOVE_NORMAL)

  return true
}

/**
 * Raises the priority while the `server_priority` flag is on in the server's base configuration, where no request
 * names a location.
 */
export const apply = Effect.gen(function* () {
  const global = yield* Global.Service
  const locations = yield* LocationServiceMap.Service
  const enabled = yield* Flag.enabled("server_priority").pipe(
    Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))),
    Effect.orElseSucceed(() => false),
  )
  if (!enabled) return
  yield* Effect.try(raise).pipe(
    Effect.flatMap((raised) => (raised ? Effect.logInfo("server runs above normal priority") : Effect.void)),
    Effect.catch((cause) => Effect.logWarning("failed to raise the server's priority", { cause })),
  )
})
