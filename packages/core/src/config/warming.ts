export * as ConfigWarming from "./warming"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("Config.Warming")({
  prompt: Schema.String.pipe(Schema.optional).annotate({
    description: "Prompt sent for keep-alive requests",
  }),
  interval: Schema.DurationFromString.pipe(Schema.optional).annotate({
    description: 'Idle time between keep-alive requests (default: "4 minutes")',
  }),
  duration: Schema.DurationFromString.pipe(Schema.optional).annotate({
    description: 'Time after the last active request to keep a session warm (default: "30 minutes")',
  }),
}) {}

export const Warming = Schema.Union([Schema.Boolean, Info])
