import sessionProjectors from "../session/projectors"
import { SyncEvent } from "../sync"

export function initProjectors() {
  SyncEvent.init(sessionProjectors)
}
