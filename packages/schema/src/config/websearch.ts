export * as ConfigWebSearch from "./websearch.js"

import { Schema } from "effect"
import { WebSearch } from "../websearch.js"

export class Info extends Schema.Class<Info>("ConfigWebSearch.Info")({
  provider: WebSearch.ID,
}) {}
