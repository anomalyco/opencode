import { Schema } from "effect"

export const Info = Schema.Struct({
  summarize: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable automatic session diff summarization during prompt processing. When false, opencode skips background session summary and per-message diff updates. Defaults to true.",
  }),
}).annotate({ identifier: "SessionConfig" })

export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigSession from "./session"
