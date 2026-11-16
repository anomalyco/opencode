import { ArtifactEndpoints } from "./artifact.js"
import { JobEndpoints } from "./job.js"
import { MediaGetEndpoint } from "./media.js"
import { PersistentPtyGroup } from "./persistent-pty.js"
import { PluginWebEndpoint } from "./plugin.js"
import { ScheduleEndpoints } from "./schedule.js"

/** `server.experimental`: routes under /api/experimental, without compatibility guarantees. */
export const ExperimentalGroup = PersistentPtyGroup.add(
  MediaGetEndpoint,
  PluginWebEndpoint,
  ...ScheduleEndpoints,
  ...ArtifactEndpoints,
  ...JobEndpoints,
)
