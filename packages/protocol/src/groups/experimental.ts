import { ArtifactEndpoints } from "./artifact.js"
import { BlobGetEndpoint } from "./blob.js"
import { AutomationEndpoints } from "./automation.js"
import { JobEndpoints } from "./job.js"
import { MachineEndpoints } from "./machine.js"
import { MediaGetEndpoint } from "./media.js"
import { PersistentPtyGroup } from "./persistent-pty.js"
import { PreferenceEndpoints } from "./preference.js"
import { PushEndpoints } from "./push.js"

/** `server.experimental`: routes under /api/experimental, without compatibility guarantees. */
export const ExperimentalGroup = PersistentPtyGroup.add(
  MediaGetEndpoint,
  BlobGetEndpoint,
  ...AutomationEndpoints,
  ...ArtifactEndpoints,
  ...JobEndpoints,
  ...MachineEndpoints,
  ...PushEndpoints,
  ...PreferenceEndpoints,
)
