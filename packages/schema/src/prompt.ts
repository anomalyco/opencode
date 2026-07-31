import { Schema } from "effect"
import { optional } from "./schema.js"
import { statics } from "./schema.js"

export interface PromptMention extends Schema.Schema.Type<typeof PromptMention> {}
export const PromptMention = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String,
}).annotate({ identifier: "Prompt.Mention" })

export const FileSource = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inline") }),
  Schema.Struct({ type: Schema.Literal("uri"), uri: Schema.String }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Prompt.FileSource" })
export type FileSource = typeof FileSource.Type

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export const Base64 = Schema.String.check(
  Schema.makeFilter((value) => (isBase64(value) ? undefined : "a base64 encoded string"), {
    expected: "a base64 encoded string",
    meta: { _tag: "isBase64", regExp: base64Pattern },
    arbitrary: { constraint: { patterns: [base64Pattern.source] } },
  }),
).annotate({ identifier: "Prompt.Base64" })
export type Base64 = typeof Base64.Type

function isBase64(value: string) {
  if (value.length % 4 !== 0) return false
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  for (let index = 0; index < value.length - padding; index++) {
    const code = value.charCodeAt(index)
    if ((code < 48 || code > 57) && (code < 65 || code > 90) && (code < 97 || code > 122) && code !== 43 && code !== 47)
      return false
  }
  return true
}

export interface FileAttachment extends Schema.Schema.Type<typeof FileAttachment> {}
export const FileAttachment = Schema.Struct({
  data: Base64,
  mime: Schema.String,
  source: FileSource,
  name: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  mention: PromptMention.pipe(optional),
})
  .annotate({ identifier: "Prompt.FileAttachment" })
  .pipe(
    statics((schema) => ({
      create: (input: FileAttachment) =>
        schema.make({
          data: input.data,
          mime: input.mime,
          source: input.source,
          name: input.name,
          description: input.description,
          mention: input.mention,
        }),
    })),
  )

export interface AgentAttachment extends Schema.Schema.Type<typeof AgentAttachment> {}
export const AgentAttachment = Schema.Struct({
  name: Schema.String,
  mention: PromptMention.pipe(optional),
}).annotate({ identifier: "Prompt.AgentAttachment" })

export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export const Prompt = Schema.Struct({
  text: Schema.String,
  files: Schema.Array(FileAttachment).pipe(optional),
  agents: Schema.Array(AgentAttachment).pipe(optional),
})
  .annotate({ identifier: "Prompt" })
  .pipe(
    statics((schema) => ({
      equivalence: Schema.toEquivalence(schema),
      fromUserMessage: (input: Pick<Prompt, "text" | "files" | "agents">) =>
        schema.make({
          text: input.text,
          ...(input.files === undefined ? {} : { files: input.files }),
          ...(input.agents === undefined ? {} : { agents: input.agents }),
        }),
    })),
  )
