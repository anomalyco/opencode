export * as ServerEvent from "./server-event.js"

import { Event } from "./event.js"

export const Connected = Event.define({ type: "server.connected", schema: {} })
export const Disposed = Event.define({ type: "global.disposed", schema: {} })

export const Definitions = Event.inventory(Connected, Disposed)
