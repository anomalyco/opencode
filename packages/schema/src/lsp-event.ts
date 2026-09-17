export * as LspEvent from "./lsp-event"

import { Event } from "./event"

export const Updated = Event.define({ type: "lsp.updated", schema: {} })

export const Definitions = Event.inventory(Updated)
