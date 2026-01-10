import { NamedError } from "@opencode-ai/util/error"
import matter from "gray-matter"
import { z } from "zod"

export namespace ConfigMarkdown {
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
  export const SHELL_REGEX = /!`([^`]+)`/g

  export function files(template: string) {
    return Array.from(template.matchAll(FILE_REGEX))
  }

  export function shell(template: string) {
    return Array.from(template.matchAll(SHELL_REGEX))
  }

  function fixYamlFrontmatter(content: string): string {
    const lines = content.split("\n")
    const result: string[] = []
    let inFrontmatter = false
    let frontmatterEnd = false

    for (const line of lines) {
      if (line.trim() === "---" && !inFrontmatter) {
        inFrontmatter = true
        result.push(line)
        continue
      }

      if (line.trim() === "---" && inFrontmatter && !frontmatterEnd) {
        frontmatterEnd = true
        inFrontmatter = false
        result.push(line)
        continue
      }

      if (!inFrontmatter) {
        result.push(line)
        continue
      }

      const colonIndex = line.indexOf(":")
      if (colonIndex === -1) {
        result.push(line)
        continue
      }

      const key = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()

      if (!value || value.startsWith("#") || value.startsWith("|") || value.startsWith(">")) {
        result.push(line)
        continue
      }

      const alreadyQuoted =
        (value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))

      if (alreadyQuoted) {
        result.push(line)
        continue
      }

      const specialChars = /[:#{}\[\],>|\*&@%`]/
      const needsQuoting = specialChars.test(value)

      if (!needsQuoting) {
        result.push(line)
        continue
      }

      let quotedValue: string
      if (value.includes("'")) {
        quotedValue = `"${value.replace(/"/g, '\\"')}"`
      } else {
        quotedValue = `'${value}'`
      }

      result.push(`${key}: ${quotedValue}`)
    }

    return result.join("\n")
  }

  export async function parse(filePath: string) {
    const template = await Bun.file(filePath).text()

    try {
      const md = matter(template)
      return md
    } catch (err) {
      const fixed = fixYamlFrontmatter(template)
      try {
        const md = matter(fixed)
        return md
      } catch {
        throw new FrontmatterError(
          {
            path: filePath,
            message: `Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
          },
          { cause: err },
        )
      }
    }
  }

  export const FrontmatterError = NamedError.create(
    "ConfigFrontmatterError",
    z.object({
      path: z.string(),
      message: z.string(),
    }),
  )
}
