export * as ConfigVoice from "./voice.js"

import { Schema } from "effect"
import { optional } from "../schema.js"
import { ConfigModel } from "./model.js"

export class Transcription extends Schema.Class<Transcription>("Config.Voice.Transcription")({
  model: ConfigModel.Selection.annotate({ description: "Speech-to-text model as provider/model" }),
  language: Schema.String.pipe(optional).annotate({ description: "Spoken language hint, such as en" }),
}) {}

export class Speech extends Schema.Class<Speech>("Config.Voice.Speech")({
  model: ConfigModel.Selection.annotate({ description: "Text-to-speech model as provider/model" }),
  voice: Schema.String.pipe(optional).annotate({ description: "Provider-native voice name or ID" }),
  language: Schema.String.pipe(optional),
  speed: Schema.Finite.pipe(optional),
  instructions: Schema.String.pipe(optional).annotate({
    description: "Delivery instructions for providers that accept them, such as OpenAI",
  }),
}) {}

export class Info extends Schema.Class<Info>("Config.Voice")({
  transcription: Transcription.pipe(optional),
  speech: Speech.pipe(optional),
}) {}
