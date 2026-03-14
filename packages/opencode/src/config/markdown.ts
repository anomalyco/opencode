import { NamedError } from "@opencode-ai/util/error"
import { $ } from "bun"
import matter from "gray-matter"
import { z } from "zod"
import { Filesystem } from "../util/filesystem"

export namespace ConfigMarkdown {
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
  export const SHELL_REGEX = /!`([^`]+)`/g

  export function files(template: string) {
    return Array.from(template.matchAll(FILE_REGEX))
  }

  export function shell(template: string) {
    return Array.from(template.matchAll(SHELL_REGEX))
  }

  /**
   * Expand !`command` directives in text by executing each command and
   * replacing the directive with its stdout.
   */
  export async function expandShell(text: string): Promise<string> {
    const matches = shell(text)
    if (matches.length > 0) {
      const results = await Promise.all(
        matches.map(async ([, cmd]) => {
          try {
            return await $`${{ raw: cmd }}`.quiet().nothrow().text()
          } catch (error) {
            return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
          }
        }),
      )
      let index = 0
      text = text.replace(SHELL_REGEX, () => results[index++]!.trim())
    }
    return text
  }

  // other coding agents like claude code allow invalid yaml in their
  // frontmatter, we need to fallback to a more permissive parser for those cases
  export function fallbackSanitization(content: string): string {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return content

    const frontmatter = match[1]
    const lines = frontmatter.split(/\r?\n/)
    const result: string[] = []

    for (const line of lines) {
      // skip comments and empty lines
      if (line.trim().startsWith("#") || line.trim() === "") {
        result.push(line)
        continue
      }

      // skip lines that are continuations (indented)
      if (line.match(/^\s+/)) {
        result.push(line)
        continue
      }

      // match key: value pattern
      const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
      if (!kvMatch) {
        result.push(line)
        continue
      }

      const key = kvMatch[1]
      const value = kvMatch[2].trim()

      // skip if value is empty, already quoted, or uses block scalar
      if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) {
        result.push(line)
        continue
      }

      // if value contains a colon, convert to block scalar
      if (value.includes(":")) {
        result.push(`${key}: |-`)
        result.push(`  ${value}`)
        continue
      }

      result.push(line)
    }

    const processed = result.join("\n")
    return content.replace(frontmatter, () => processed)
  }

  export async function parse(filePath: string) {
    const template = await Filesystem.readText(filePath)

    try {
      const md = matter(template)
      return md
    } catch {
      try {
        return matter(fallbackSanitization(template))
      } catch (err) {
        throw new FrontmatterError(
          {
            path: filePath,
            message: `${filePath}: Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
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
