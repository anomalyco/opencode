import { ArtifactEndpoints } from "./artifact.js"
import { BlobGetEndpoint } from "./blob.js"
import { BrowserTunnelEndpoint } from "./experimental/browser-tunnel.js"
import { AutomationEndpoints } from "./automation.js"
import { JobEndpoints } from "./job.js"
import { MachineEndpoints } from "./machine.js"
import { MediaGetEndpoint } from "./media.js"
import { PersistentPtyGroup } from "./persistent-pty.js"
import { PushEndpoints } from "./push.js"

/** `server.experimental`: routes under /api/experimental, without compatibility guarantees. */
export const ExperimentalGroup = PersistentPtyGroup.add(
  MediaGetEndpoint,
  BlobGetEndpoint,
  BrowserTunnelEndpoint,
  ...AutomationEndpoints,
  ...ArtifactEndpoints,
  ...JobEndpoints,
  ...MachineEndpoints,
  ...PushEndpoints,
)
