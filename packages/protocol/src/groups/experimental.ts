import { MediaGetEndpoint } from "./media.js"
import { PersistentPtyGroup } from "./persistent-pty.js"
import { ScheduleEndpoints } from "./schedule.js"

/** `server.experimental`: routes under /api/experimental, without compatibility guarantees. */
export const ExperimentalGroup = PersistentPtyGroup.add(MediaGetEndpoint, ...ScheduleEndpoints)
