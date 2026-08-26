import { Filesystem } from "@/util/filesystem"
import { FrontmatterError } from "@opencode-ai/core/v1/config/error"
import { ConfigMarkdown as ConfigMarkdownCore } from "@opencode-ai/core/config/markdown"
import matter from "gray-matter"
import path from "path"

export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
export const SHELL_REGEX = /!`([^`]+)`/g
export const FILE_REF_REGEX = /\{file:([^}]+)\}/g

export type InterpolationError =
  | { type: "circular"; refPath: string; resolvedPath: string }
  | { type: "not_found"; refPath: string; resolvedPath: string }
  | { type: "max_depth"; refPath: string; resolvedPath: string }

export interface InterpolationResult {
  content: string
  errors: InterpolationError[]
}

export function files(template: string) {
  return Array.from(template.matchAll(FILE_REGEX))
}

export function shell(template: string) {
  return Array.from(template.matchAll(SHELL_REGEX))
}

// other coding agents like claude code allow invalid yaml in their
// frontmatter, we need to fallback to a more permissive parser for those cases
export const fallbackSanitization = ConfigMarkdownCore.sanitize

export async function parse(filePath: string) {
  const template = await Filesystem.readText(filePath)

  try {
    return ConfigMarkdownCore.parse(template)
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

export async function interpolateFiles(
  content: string,
  baseDir: string,
  chain: Set<string> = new Set(),
  depth: number = 0,
  maxDepth: number = 5,
): Promise<InterpolationResult> {
  const matches = Array.from(content.matchAll(FILE_REF_REGEX))
  if (!matches.length) return { content, errors: [] }
  if (depth > maxDepth) {
    const errors: InterpolationError[] = []
    const replaced = content.replace(FILE_REF_REGEX, (_, refPath) => {
      const rp = refPath.trim()
      const resolved = rp.startsWith("~")
        ? path.join(process.env.HOME ?? "", rp.replace(/^~/, ""))
        : path.resolve(baseDir, rp)
      errors.push({ type: "max_depth", refPath: rp, resolvedPath: resolved })
      return `<!-- Max include depth exceeded: ${rp} -->`
    })
    return { content: replaced, errors }
  }

  let result = content
  const allErrors: InterpolationError[] = []
  for (const match of matches) {
    const refPath = match[1].trim()
    const resolvedPath = refPath.startsWith("~")
      ? path.join(process.env.HOME ?? "", refPath.replace(/^~/, ""))
      : path.resolve(baseDir, refPath)

    if (chain.has(resolvedPath)) {
      allErrors.push({ type: "circular", refPath, resolvedPath })
      result = result.replace(match[0], `<!-- Circular file reference: ${refPath} -->`)
      continue
    }

    const fileContent = await Filesystem.readText(resolvedPath).catch(() => undefined)
    if (fileContent === undefined) {
      allErrors.push({ type: "not_found", refPath, resolvedPath })
      result = result.replace(match[0], `<!-- File not found: ${refPath} -->`)
      continue
    }

    const nextChain = new Set(chain)
    nextChain.add(resolvedPath)

    const body = matter(fileContent).content
    const interpolated = await interpolateFiles(body, path.dirname(resolvedPath), nextChain, depth + 1, maxDepth)
    allErrors.push(...interpolated.errors)
    result = result.replace(match[0], interpolated.content)
  }

  return { content: result, errors: allErrors }
}

export * as ConfigMarkdown from "./markdown"
