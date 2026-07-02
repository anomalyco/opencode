export * as LspEvent from "./lsp-event.js"

import { Event } from "./event.js"

export const Updated = Event.define({ type: "lsp.updated", schema: {} })

export const Definitions = Event.inventory(Updated)
