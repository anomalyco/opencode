import type { Context } from "effect"
import type { HttpApiMiddleware } from "effect/http-api"
import { ArtifactEndpoints } from "./artifact.js"
import { ConsoleSlackMessageEndpoint } from "./console.js"
import { JobEndpoints } from "./job.js"
import { MediaGetEndpoint } from "./media.js"
import { PersistentPtyGroup } from "./persistent-pty.js"
import { ScheduleEndpoints } from "./schedule.js"

/** `server.experimental`: routes under /api/experimental, without compatibility guarantees. */
export const ExperimentalGroup = PersistentPtyGroup.add(
  MediaGetEndpoint,
  ...ScheduleEndpoints,
  ...ArtifactEndpoints,
  ...JobEndpoints,
)

export const makeExperimentalGroup = <LocationId extends HttpApiMiddleware.AnyId, LocationService>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
) => ExperimentalGroup.add(ConsoleSlackMessageEndpoint.middleware(locationMiddleware))
