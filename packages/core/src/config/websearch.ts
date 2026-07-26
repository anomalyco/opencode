export * as ConfigWebSearch from "./websearch"

import { WebSearch } from "@opencode-ai/schema/websearch"
import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigWebSearch.Info")({
  provider: WebSearch.ID,
}) {}
