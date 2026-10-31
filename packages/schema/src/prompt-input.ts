export * as PromptInput from "./prompt-input.js"

import { Schema } from "effect"
import { AgentAttachment, FileSource, PromptMention } from "./prompt.js"
import { optional } from "./schema.js"
import { Skill } from "./skill.js"

export interface FileAttachment extends Schema.Schema.Type<typeof FileAttachment> {}
export const FileAttachment = Schema.Struct({
  uri: Schema.String,
  // Source metadata does not require reopening the original file.
  source: FileSource.pipe(optional),
  name: Schema.String.pipe(optional),
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
  files: Schema.Array(FileAttachment).pipe(optional),
  agents: Schema.Array(AgentAttachment).pipe(optional),
  skills: Schema.Array(SkillAttachment).pipe(optional),
}).annotate({ identifier: "PromptInput" })
