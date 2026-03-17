import { NamedError } from "@opencode-ai/util/error"
import matter from "gray-matter"
import { z } from "zod"
import { Filesystem } from "../util/filesystem"

/**
 * ConfigMarkdown namespace providing utilities for parsing markdown configuration files.
 *
 * Handles extracting file references and shell commands from markdown templates,
 * sanitizing YAML frontmatter for compatibility with various AI coding agents,
 * and parsing markdown files with frontmatter.
 *
 * @example
 * ```typescript
 * const files = ConfigMarkdown.files(template)
 * const shell = ConfigMarkdown.shell(template)
 * const parsed = await ConfigMarkdown.parse("/path/to/file.md")
 * ```
 */
export namespace ConfigMarkdown {
  /**
   * Regex pattern for matching file references in templates.
   * Matches patterns like @file or @path/to/file
   */
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g

  /**
   * Regex pattern for matching shell command references in templates.
   * Matches patterns like !`command`
   */
  export const SHELL_REGEX = /!`([^`]+)`/g

  /**
   * Extracts file references from a template string.
   *
   * @param template - The template string to search
   * @returns An array of match arrays containing file references
   */
  export function files(template: string) {
    return Array.from(template.matchAll(FILE_REGEX))
  }

  /**
   * Extracts shell command references from a template string.
   *
   * @param template - The template string to search
   * @returns An array of match arrays containing shell commands
   */
  export function shell(template: string) {
    return Array.from(template.matchAll(SHELL_REGEX))
  }

  // other coding agents like claude code allow invalid yaml in their
  // frontmatter, we need to fallback to a more permissive parser for those cases
  /**
   * Sanitizes YAML frontmatter content to handle invalid YAML syntax.
   *
   * Other coding agents like Claude Code allow invalid YAML in their frontmatter.
   * This function converts problematic values (like those containing colons)
   * to block scalar format to ensure compatibility.
   *
   * @param content - The markdown content with frontmatter
   * @returns The sanitized content with fixed YAML frontmatter
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
   * Parses a markdown file and extracts its frontmatter.
   *
   * Uses gray-matter for parsing. If the initial parse fails due to YAML
   * issues, falls back to sanitized parsing. Throws FrontmatterError if
   * parsing still fails after sanitization.
   *
   * @param filePath - The path to the markdown file
   * @returns A promise resolving to the parsed matter object
   * @throws FrontmatterError if parsing fails
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
   * Error thrown when YAML frontmatter parsing fails.
   */
  export const FrontmatterError = NamedError.create(
    "ConfigFrontmatterError",
    z.object({
      path: z.string(),
      message: z.string(),
    }),
  )
}
