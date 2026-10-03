export * as ConfigWarming from "./warming.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Warming")({
  prompt: Schema.String.annotate({
    description: "Prompt sent for keep-alive requests",
  }).pipe(optional),
  interval: Schema.DurationFromString.annotate({
    description: 'Idle time between keep-alive requests (default: "4 minutes")',
  }).pipe(optional),
  duration: Schema.DurationFromString.annotate({
    description: 'Time after the last active request to keep a session warm (default: "30 minutes")',
  }).pipe(optional),
}) {}

export const Warming = Schema.Union([Schema.Boolean, Info])
