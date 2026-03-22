import z from "zod"
import sessionProjectors from "../session/projectors"
import { SyncEvent } from "@/sync"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"

let initialized = false

export function initProjectors() {
  if (initialized) {
    return
  }
  initialized = true

  SyncEvent.init({
    projectors: sessionProjectors,
    convertDefinition: (type, data) => {
      if (type === "session.updated") {
        return z.object({
          sessionID: SessionID.zod,
          info: Session.Info,
        })
      }
      return data
    },
    convertEvent: (type, data) => {
      if (type === "session.updated") {
        const sessionID = (data as z.infer<typeof Session.Event.Updated.data>).sessionID
        return {
          sessionID: SessionID.zod,
          info: Session.get(sessionID),
        }
      }
      return data
    },
  })
}

initProjectors()
