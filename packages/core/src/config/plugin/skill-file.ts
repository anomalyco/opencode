export * as SkillFile from "./skill-file.js"

import path from "path"
import { Result, Schema, type SchemaIssue, SchemaParser } from "effect"
import { ConfigMarkdown } from "../markdown.js"
import { AbsolutePath } from "../../schema.js"
import { Skill } from "../../skill.js"

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  metadata: Schema.Unknown.pipe(Schema.optional),
  "disable-model-invocation": Schema.Unknown.pipe(Schema.optional),
})
const decodeFrontmatter = SchemaParser.decodeUnknownResult(Frontmatter)

export type ParseResult =
  | { readonly _tag: "Parsed"; readonly skill: Skill.Info }
  | { readonly _tag: "Skipped"; readonly reason: "markdown" }
  | { readonly _tag: "Skipped"; readonly reason: "frontmatter"; readonly issue: SchemaIssue.Issue }

const metadataBoolean = (metadata: unknown, key: string) => {
  if (metadata === undefined || metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined
  }
  return booleanValue((metadata as Record<string, unknown>)[key])
}

// Matches the boolean spellings Claude Code accepts in skill frontmatter.
const booleanValue = (value: unknown) => {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (["true", "yes", "on", "1"].includes(normalized)) return true
  if (["false", "no", "off", "0"].includes(normalized)) return false
  return undefined
}

export function parse(directory: string, filepath: string, content: string): ParseResult {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return { _tag: "Skipped", reason: "markdown" }
  const decoded = decodeFrontmatter(markdown.data)
  if (Result.isFailure(decoded)) return { _tag: "Skipped", reason: "frontmatter", issue: decoded.failure }
  const frontmatter = decoded.success
  const id =
    path.dirname(filepath) === directory && path.basename(filepath) !== "SKILL.md"
      ? path.basename(filepath, ".md")
      : path.basename(path.dirname(filepath))
  // `disable-model-invocation` is the Claude Code / Cursor spelling of `opencode/autoinvoke: false`.
  const disableModelInvocation = booleanValue(frontmatter["disable-model-invocation"])
  const autoinvoke =
    metadataBoolean(frontmatter.metadata, "opencode/autoinvoke") ??
    (disableModelInvocation === undefined ? undefined : !disableModelInvocation)
  return {
    _tag: "Parsed",
    skill: {
      id: Skill.ID.make(id),
      name: Skill.Name.make(frontmatter.name ?? id),
      ...(frontmatter.description === undefined ? {} : { description: frontmatter.description }),
      ...(autoinvoke === undefined ? {} : { autoinvoke }),
      path: AbsolutePath.make(filepath),
      content: markdown.content,
    },
  }
}
