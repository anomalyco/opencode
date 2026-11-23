export * as PromptInput from "./prompt-input.js"

import { Schema } from "effect"
import { AgentAttachment, FileSource, PromptMention } from "./prompt.js"
import { optional } from "./schema.js"
import { Skill } from "./skill.js"

export interface FileAttachment extends Schema.Schema.Type<typeof FileAttachment> {}
export const FileAttachment = Schema.Struct({
  uri: Schema.String.annotate({
    description:
      "A file: URL to a file or directory on the server (add ?start=N&end=M to send only those lines of a text file), a data: URL with the content inline, or a media: ref read back from a message. Up to 20 MB.",
  }),
  // Source metadata does not require reopening the original file.
  source: FileSource.pipe(optional),
  name: Schema.String.annotate({
    description: "File name shown for the attachment. Defaults to the file's base name for file: URLs.",
  }).pipe(optional),
  description: Schema.String.pipe(optional),
  mention: PromptMention.pipe(optional),
}).annotate({ identifier: "PromptInput.FileAttachment" })

export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export interface SkillAttachment extends Schema.Schema.Type<typeof SkillAttachment> {}
export const SkillAttachment = Schema.Struct({
  id: Skill.ID,
  mention: PromptMention.pipe(optional),
}).annotate({ identifier: "PromptInput.SkillAttachment" })

export const Prompt = Schema.Struct({
  text: Schema.String,
  files: Schema.Array(FileAttachment)
    .annotate({
      description: "Files sent to the model with the message. The server reads them when the request arrives.",
    })
    .pipe(optional),
  agents: Schema.Array(AgentAttachment)
    .annotate({
      description: "Agents mentioned in text, kept on the message for display.",
    })
    .pipe(optional),
  skills: Schema.Array(SkillAttachment)
    .annotate({
      description:
        "Skills to load with the message. Each skill's instructions are added to what the model sees. An unknown skill ID fails the request.",
    })
    .pipe(optional),
}).annotate({ identifier: "PromptInput" })
