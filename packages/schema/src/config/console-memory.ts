export * as ConfigConsoleMemory from "./console-memory.js"

import { Schema } from "effect"
import { optional } from "../schema.js"
import { ConfigModel } from "./model.js"

/**
 * How the OpenCode Console workspace's memory runs here, beyond on or off: an endpoint of one's own in its place, as a
 * remote MCP server is configured, and the decision model it asks.
 */
export class Settings extends Schema.Class<Settings>("ConfigConsoleMemory.Settings")({
  url: Schema.String.pipe(optional).annotate({
    description:
      "Base URL of a memory endpoint to use instead of the Console workspace's: memory's config check, /api/memory requests and evidence go there, with no Console sign-in needed",
  }),
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional).annotate({
    description:
      "Headers sent with every request to that endpoint, such as a credential; {env:VAR} and {file:path} work here, and they're never logged",
  }),
  decisions: Schema.Union([Schema.Literal(false), ConfigModel.Selection])
    .pipe(optional)
    .annotate({
      description:
        'The decision model memory asks which messages state lasting rules, which entries they correct, which lessons last and which entries apply, as "provider/model" (default: opencode/jev-1.13); false turns decisions off, and with them capture, correction reminders and the delivery check, leaving delivery to the Console scoring alone',
    }),
}) {}

export const ConsoleMemory = Schema.Union([Schema.Boolean, Settings])
export type ConsoleMemory = typeof ConsoleMemory.Type
