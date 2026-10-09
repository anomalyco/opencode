export * as ConfigWebSearch from "./websearch.js"

import { Schema } from "effect"
import { WebSearch } from "../websearch.js"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("ConfigWebSearch.Info")({
  provider: Schema.Union([
    Schema.Literal("random").annotate({
      description:
        "Reuse a randomly selected provider until it is rate limited, then switch to another available provider.",
    }),
    WebSearch.ID,
  ])
    .pipe(optional)
    .annotate({
      description: "Provider to use for web search. Omit to keep the current selection or choose per session.",
    }),
  providers: Schema.Record(WebSearch.ID, WebSearch.Settings).pipe(optional).annotate({
    description: "Per-provider overrides keyed by provider id",
  }),
}) {}

export const Selection = Schema.Union([Schema.Literal(false), Info])
export type Selection = typeof Selection.Type
