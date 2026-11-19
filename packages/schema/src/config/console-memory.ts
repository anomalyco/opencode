export * as ConfigConsoleMemory from "./console-memory.js"

import { Schema } from "effect"
import { optional } from "../schema.js"
import { ConfigModel } from "./model.js"

/** How the OpenCode Console workspace's memory runs here, beyond on or off. */
export class Settings extends Schema.Class<Settings>("ConfigConsoleMemory.Settings")({
  decisions: Schema.Union([Schema.Literal(false), ConfigModel.Selection])
    .pipe(optional)
    .annotate({
      description:
        'The decision model memory asks which messages state lasting rules, which entries they correct, which lessons last and which entries apply, as "provider/model" (default: opencode/jev-1.13); false answers without one',
    }),
}) {}

export const ConsoleMemory = Schema.Union([Schema.Boolean, Settings])
export type ConsoleMemory = typeof ConsoleMemory.Type
