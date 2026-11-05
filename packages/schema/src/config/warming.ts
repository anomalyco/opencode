export * as ConfigWarming from "./warming.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Warming")({
  prompt: Schema.String.pipe(optional).annotate({
    description:
      "Deprecated and ignored: keep-alive requests resend the session's last request instead of a prompt. Removed in the next minor.",
  }),
  interval: Schema.Union([Schema.Literal("auto"), Schema.DurationFromString])
    .pipe(optional)
    .annotate({
      description:
        'Time from a model request to the keep-alive that refreshes its cache (default: "auto", 90% of the cache lifetime the request was sent with, so 4.5 minutes for a 5-minute cache)',
    }),
  duration: Schema.DurationFromString.pipe(optional).annotate({
    description:
      'Time after the latest model request to keep a session warm while its turn runs (default: "30 minutes")',
  }),
  idle: Schema.DurationFromString.pipe(optional).annotate({
    description: 'Time after a session\'s turn ends to keep it warm (default: "15 minutes")',
  }),
}) {}

export const Warming = Schema.Union([Schema.Boolean, Info])
