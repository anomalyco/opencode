export * as SkillFile from "./skill-file"

import path from "path"
import { Schema } from "effect"
import { ConfigMarkdown } from "../markdown"
import { AbsolutePath } from "../../schema"
import { Skill } from "../../skill"

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  slash: Schema.Boolean.pipe(Schema.optional),
  metadata: Schema.Unknown.pipe(Schema.optional),
})
const decodeFrontmatter = Schema.decodeUnknownOption(Frontmatter)

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

export function parse(directory: string, filepath: string, content: string): Skill.Info | undefined {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return undefined
  const frontmatter = decodeFrontmatter(markdown.data).valueOrUndefined
  if (!frontmatter) return undefined
  const id =
    path.dirname(filepath) === directory ? path.basename(filepath, ".md") : path.basename(path.dirname(filepath))
  const slash = metadataBoolean(frontmatter.metadata, "opencode/slash") ?? frontmatter.slash
  const autoinvoke = metadataBoolean(frontmatter.metadata, "opencode/autoinvoke")
  return {
    id: Skill.ID.make(id),
    name: Skill.Name.make(frontmatter.name ?? id),
    ...(frontmatter.description === undefined ? {} : { description: frontmatter.description }),
    ...(slash === undefined ? {} : { slash }),
    ...(autoinvoke === undefined ? {} : { autoinvoke }),
    location: AbsolutePath.make(filepath),
    content: markdown.content,
  }
}
