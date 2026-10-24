import { SessionTimelineEndpoint } from "./message.js"
import { PersistentPtyGroup } from "./persistent-pty.js"

/** Every endpoint here is generated under the client's `experimental` namespace. */
export const ExperimentalGroup = PersistentPtyGroup.add(SessionTimelineEndpoint)
