export * as SkillFile from "./skill-file.js"

import path from "path"
import { Effect, Result, Schema, type SchemaIssue, SchemaParser } from "effect"
import type { FSUtil } from "@opencode/util/fs-util"
import { ConfigMarkdown } from "../markdown.js"
import { AbsolutePath } from "../../schema.js"
import { Skill } from "../../skill.js"

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
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
  const value = (metadata as Record<string, unknown>)[key]
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
    path.dirname(filepath) === directory && path.basename(filepath) !== "SKILL.md"
      ? path.basename(filepath, ".md")
      : path.basename(path.dirname(filepath))
  const autoinvoke = metadataBoolean(frontmatter.metadata, "opencode/autoinvoke")
  return {
    _tag: "Parsed",
    skill: {
      id: Skill.ID.make(id),
      name: Skill.Name.make(frontmatter.name ?? id),
      ...(frontmatter.description === undefined ? {} : { description: frontmatter.description }),
      ...(autoinvoke === undefined ? {} : { autoinvoke }),
      path: AbsolutePath.make(filepath),
    },
  }
}

export const read = (fs: FSUtil.Interface, filepath: string): Skill.Load =>
  Effect.fn("SkillFile.read")(function* () {
    const text = yield* fs.readFileString(filepath).pipe(Effect.orDie)
    return ConfigMarkdown.parseOption(text)?.content ?? text
  })
