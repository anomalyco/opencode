export * as CommandEvent from "./command-event"

import { Event } from "./event"

// Emitted when commands change after the initial load (e.g. MCP prompts
// finish connecting); clients should re-fetch /command.
export const Updated = Event.define({ type: "command.updated", schema: {} })

export const Definitions = Event.inventory(Updated)
