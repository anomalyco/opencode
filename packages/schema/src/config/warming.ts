export * as ConfigWarming from "./warming.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Warming")({
  prompt: Schema.String.pipe(optional).annotate({
    description: "Prompt for keep-alive requests to models that can't be kept warm by resending their last request",
  }),
  interval: Schema.Union([Schema.Literal("auto"), Schema.DurationFromString])
    .pipe(optional)
    .annotate({
      description:
        'Time from a model request to its keep-alive (default: "auto"). "auto" uses 90% of the cache lifetime: the one the request was sent with, else the model\'s cache.ttl, else 4 minutes.',
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
