import os from "os"
import path from "path"

/**
 * Regular expression to match @ file references in text
 * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
 * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
 */
export const fileRegex = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g

/**
 * File part type for chat input
 */
export type FilePart = {
  type: "file"
  url: string
  filename: string
  mime: string
}

/**
 * Processes file references in a template string and returns file parts
 * @param template - The template string containing @file references
 * @param basePath - The base path to resolve relative file paths against
 * @returns Array of file parts for the chat input
 */
export function processFileReferences(template: string, basePath: string): FilePart[] {
  // intentionally doing match regex doing bash regex replacements
  // this is because bash commands can output "@" references
  const matches = template.matchAll(fileRegex)

  const parts: FilePart[] = []
  for (const match of matches) {
    const filename = match[1]
    const filepath = filename.startsWith("~/")
      ? path.join(os.homedir(), filename.slice(2))
      : path.resolve(basePath, filename)

    parts.push({
      type: "file",
      url: `file://${filepath}`,
      filename,
      mime: "text/plain",
    })
  }

  return parts
}
