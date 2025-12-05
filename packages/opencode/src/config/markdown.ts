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

  // Perform {env:VAR} interpolation on frontmatter data only
  function interpolateEnvironmentVariables(obj: any): any {
    if (typeof obj === "string") {
      return obj.replace(/\{env:([^}]+)\}/g, (_, varName) => {
        return process.env[varName] || ""
      })
    } else if (Array.isArray(obj)) {
      return obj.map(interpolateEnvironmentVariables)
    } else if (obj && typeof obj === "object") {
      const result: any = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = interpolateEnvironmentVariables(value)
      }
      return result
    }
    return obj
  }

  export async function parse(filePath: string) {
    const template = await Bun.file(filePath).text()

    try {
      const md = matter(template)
      md.data = interpolateEnvironmentVariables(md.data)
      return md
    } catch (err) {
      throw new FrontmatterError(
        {
          path: filePath,
          message: `Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        },
        { cause: err },
      )
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
