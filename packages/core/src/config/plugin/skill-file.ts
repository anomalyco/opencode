export * as SkillFile from "./skill-file.js"

import path from "path"
import { Result, Schema, type SchemaIssue, SchemaParser } from "effect"
import { ConfigMarkdown } from "../markdown.js"
import { AbsolutePath } from "../../schema.js"
import { Skill } from "../../skill.js"

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  slash: Schema.Boolean.pipe(Schema.optional),
  metadata: Schema.Unknown.pipe(Schema.optional),
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
  const value = Reflect.get(metadata, key)
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  return undefined
}

export function parse(directory: string, filepath: string, content: string): ParseResult {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return { _tag: "Skipped", reason: "markdown" }
  const decoded = decodeFrontmatter(markdown.data)
  if (Result.isFailure(decoded)) return { _tag: "Skipped", reason: "frontmatter", issue: decoded.failure }
  const frontmatter = decoded.success
  const id =
    path.dirname(filepath) === directory ? path.basename(filepath, ".md") : path.basename(path.dirname(filepath))
  const slash = metadataBoolean(frontmatter.metadata, "opencode/slash") ?? frontmatter.slash
  const autoinvoke = metadataBoolean(frontmatter.metadata, "opencode/autoinvoke")
  return {
    _tag: "Parsed",
    skill: {
      id: Skill.ID.make(id),
      name: Skill.Name.make(frontmatter.name ?? id),
      ...(frontmatter.description === undefined ? {} : { description: frontmatter.description }),
      ...(slash === undefined ? {} : { slash }),
      ...(autoinvoke === undefined ? {} : { autoinvoke }),
      location: AbsolutePath.make(filepath),
      content: markdown.content,
    },
  }
}
