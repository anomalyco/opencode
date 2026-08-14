export * as ConfigWebSearch from "./websearch.js"

import { Schema } from "effect"
import { WebSearch } from "../websearch.js"

export class Info extends Schema.Class<Info>("ConfigWebSearch.Info")({
  provider: Schema.Union([Schema.Literal("random"), WebSearch.ID]),
}) {}

export const Selection = Schema.Union([Schema.Literal(false), Info])
export type Selection = typeof Selection.Type
