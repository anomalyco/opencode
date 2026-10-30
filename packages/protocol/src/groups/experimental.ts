import { ArtifactEndpoints } from "./artifact.js"
import { AutomationEndpoints } from "./automation.js"
import { MediaGetEndpoint } from "./media.js"
import { PersistentPtyGroup } from "./persistent-pty.js"

/** `server.experimental`: routes under /api/experimental, without compatibility guarantees. */
export const ExperimentalGroup = PersistentPtyGroup.add(MediaGetEndpoint, ...AutomationEndpoints, ...ArtifactEndpoints)
