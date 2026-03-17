import { NamedError } from "@opencode-ai/util/error"
import matter from "gray-matter"
import { z } from "zod"
import { Filesystem } from "../util/filesystem"

/**
 * Markdown configuration parsing utilities.
 *
 * Provides functions for parsing markdown templates with file references,
 * shell commands, and YAML frontmatter. Includes fallback sanitization
 * for invalid YAML frontmatter commonly found in other coding agents.
 *
 * @example
 * ```typescript
 * const md = await ConfigMarkdown.parse("/path/to/file.md")
 * console.log(md.data) // frontmatter data
 * console.log(md.content) // markdown content
 * ```
 */
export namespace ConfigMarkdown {
  /**
   * Regular expression to match file references in templates.
   * Matches patterns like @file.txt or @path/to/file.ts
   */
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g

  /**
   * Regular expression to match shell command references in templates.
   * Matches patterns like !`command`
   */
  export const SHELL_REGEX = /!`([^`]+)`/g

  /**
   * Extracts file references from a template string.
   *
   * @param template - The template string to search
   * @returns Array of regex match results for file references
   */
  export function files(template: string) {
    return Array.from(template.matchAll(FILE_REGEX))
  }

  /**
   * Extracts shell command references from a template string.
   *
   * @param template - The template string to search
   * @returns Array of regex match results for shell commands
   */
  export function shell(template: string) {
    return Array.from(template.matchAll(SHELL_REGEX))
  }

  /**
   * Sanitizes invalid YAML frontmatter for compatibility.
   *
   * Other coding agents like Claude Code allow invalid YAML in their frontmatter.
   * This function provides a fallback parser that handles common issues such as
   * unquoted colons in values by converting them to block scalar format.
   *
   * @param content - The markdown content with frontmatter to sanitize
   * @returns Sanitized content with valid YAML frontmatter
   */
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

  /**
   * Parses a markdown file, extracting frontmatter and content.
   *
   * First attempts standard YAML frontmatter parsing with gray-matter.
   * If that fails, applies fallback sanitization and retries.
   * Throws FrontmatterError if parsing fails after sanitization.
   *
   * @param filePath - Path to the markdown file to parse
   * @returns Parsed markdown object with data (frontmatter) and content
   * @throws FrontmatterError when YAML frontmatter cannot be parsed
   */
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

  /**
   * Error thrown when markdown frontmatter parsing fails.
   */
  export const FrontmatterError = NamedError.create(
    "ConfigFrontmatterError",
    z.object({
      path: z.string(),
      message: z.string(),
    }),
  )
}
