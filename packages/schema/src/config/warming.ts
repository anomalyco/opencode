export * as ConfigWarming from "./warming.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Warming")({
  prompt: Schema.String.pipe(optional).annotate({
    description: "Prompt sent for keep-alive requests",
  }),
  interval: Schema.Union([Schema.Literal("auto"), Schema.DurationFromString])
    .pipe(optional)
    .annotate({
      description:
        'Idle time between keep-alive requests (default: "4 minutes"). "auto" uses 90% of the model\'s cache.ttl and skips models without one.',
    }),
  duration: Schema.DurationFromString.pipe(optional).annotate({
    description: 'Time after the last active request to keep a session warm (default: "30 minutes")',
  }),
}) {}

export const Warming = Schema.Union([Schema.Boolean, Info])
