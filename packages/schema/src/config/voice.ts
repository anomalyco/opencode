export * as ConfigVoice from "./voice.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("ConfigVoice.Info")({
  url: Schema.String.pipe(optional).annotate({
    description: "OpenAI-compatible transcription endpoint (voice input is disabled while unset)",
  }),
  apiKey: Schema.String.pipe(optional).annotate({
    description: "API key sent as a Bearer token; leave unset for local servers",
  }),
  model: Schema.String.pipe(optional).annotate({
    description: "Model name sent to the transcription endpoint",
  }),
}) {}
