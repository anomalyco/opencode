export * as ConfigWebSearch from "./websearch.js"

import { Schema } from "effect"
import { WebSearch } from "../websearch.js"

export class Info extends Schema.Class<Info>("ConfigWebSearch.Info")({
  provider: Schema.Union([
    Schema.Literal("auto").annotate({
      description:
        "Reuse a randomly selected provider until it is rate limited, then switch to another available provider.",
    }),
    Schema.Literal("random").annotate({ description: 'Deprecated alias for "auto".', deprecated: true }),
    WebSearch.ID,
  ]),
}) {}

export const Selection = Schema.Union([Schema.Literal(false), Info])
export type Selection = typeof Selection.Type
