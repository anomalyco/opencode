import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"

/**
 * Whether a flag is on in the server's base configuration, where the video routes read theirs. Off when that
 * configuration fails to load.
 */
export const baseFlag = (key: Flag.Key) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    return Flag.enabled(key).pipe(
      Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))),
      Effect.orElseSucceed(() => false),
    )
  })
