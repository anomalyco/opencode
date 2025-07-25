import { App } from "../app/app"
import { Ripgrep } from "../file/ripgrep"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"
import path from "path"
import os from "os"
import { z } from "zod"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"
import PROMPT_SUMMARIZE from "./prompt/summarize.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { NamedError } from "../util/error.ts"

export namespace SystemPrompt {
  const MAX_PROMPT_LENGTH = 50000

  export function header(providerID: string) {
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }
  export function provider(modelID: string) {
    if (modelID.includes("gpt-") || modelID.includes("o1") || modelID.includes("o3")) return [PROMPT_BEAST]
    if (modelID.includes("gemini-")) return [PROMPT_GEMINI]
    return [PROMPT_ANTHROPIC]
  }

  export async function environment() {
    const app = App.info()
    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${app.path.cwd}`,
        `  Is directory a git repo: ${app.git ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<project>`,
        `  ${
          app.git
            ? await Ripgrep.tree({
                cwd: app.path.cwd,
                limit: 200,
              })
            : ""
        }`,
        `</project>`,
      ].join("\n"),
    ]
  }

  const CUSTOM_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    "CONTEXT.md", // deprecated
  ]

  export async function custom() {
    const { cwd, root } = App.info().path
    const config = await Config.get()
    const found = []
    for (const item of CUSTOM_FILES) {
      const matches = await Filesystem.findUp(item, cwd, root)
      found.push(...matches.map((x) => Bun.file(x).text()))
    }
    found.push(
      Bun.file(path.join(Global.Path.config, "AGENTS.md"))
        .text()
        .catch(() => ""),
    )
    found.push(
      Bun.file(path.join(os.homedir(), ".claude", "CLAUDE.md"))
        .text()
        .catch(() => ""),
    )

    if (config.instructions) {
      for (const instruction of config.instructions) {
        try {
          const matches = await Filesystem.globUp(instruction, cwd, root)
          found.push(...matches.map((x) => Bun.file(x).text()))
        } catch {
          continue // Skip invalid glob patterns
        }
      }
    }

    return Promise.all(found).then((result) => result.filter(Boolean))
  }

  export function summarize(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_SUMMARIZE]
      default:
        return [PROMPT_SUMMARIZE]
    }
  }

  export function title(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_TITLE]
      default:
        return [PROMPT_TITLE]
    }
  }

  const commandPattern = /(?<!\\)\$`([^`]+)`/g
  async function resolveBashCommands(content: string, basePath: string, name: string): Promise<string> {
    let result = content
    let totalLength = content.length

    const matches = Array.from(content.matchAll(commandPattern))

    for (const match of matches) {
      const [fullMatch, command] = match

      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: basePath,
        stdout: "pipe",
        stderr: "pipe",
      })

      const output = await new Response(proc.stdout).text()
      const error = await new Response(proc.stderr).text()

      await proc.exited

      if (proc.exitCode !== 0) {
        throw new PromptResolveError({
          name,
          reference: command,
          error: `Command failed: ${command}\n${error}`,
        })
      }

      const trimmedOutput = output.trim()
      totalLength = totalLength - fullMatch.length + trimmedOutput.length

      if (totalLength > MAX_PROMPT_LENGTH) {
        throw new PromptResolveError({
          name,
          reference: command,
          error: `Prompt length exceeds ${MAX_PROMPT_LENGTH} characters after resolving commands`,
        })
      }

      result = result.replace(fullMatch, trimmedOutput)
    }

    result = result.replace(/\\\$/g, "$")

    return result
  }

  const linkPattern = /(?<!\\)(?<=^|\s)@([^\s]+)/gm
  async function resolveLinks(
    content: string,
    basePath: string,
    name: string,
    visited: Set<string> = new Set(),
  ): Promise<string> {
    let result = content
    let totalLength = content.length

    const matches = Array.from(content.matchAll(linkPattern))

    for (const match of matches) {
      const [fullMatch, linkPath] = match
      const resolvedPath = path.resolve(basePath, linkPath)

      if (visited.has(resolvedPath)) {
        throw new PromptResolveError({
          name,
          reference: resolvedPath,
          error: `Circular dependency detected: ${resolvedPath}`,
        })
      }

      const file = Bun.file(resolvedPath)
      const exists = await file.exists()

      if (!exists) {
        continue
      }

      visited.add(resolvedPath)

      let fileContent: string
      try {
        fileContent = await file.text()
      } catch {
        throw new PromptResolveError({
          name,
          reference: resolvedPath,
          error: `File is not a text file: ${resolvedPath}`,
        })
      }

      const resolvedContent = await resolveLinks(fileContent, path.dirname(resolvedPath), name, visited)

      totalLength = totalLength - fullMatch.length + resolvedContent.length
      if (totalLength > MAX_PROMPT_LENGTH) {
        throw new PromptResolveError({
          name,
          reference: resolvedPath,
          error: `Prompt length exceeds ${MAX_PROMPT_LENGTH} characters after resolving links`,
        })
      }

      result = result.replace(fullMatch, resolvedContent)
      visited.delete(resolvedPath)
    }

    result = result.replace(/\\@/g, "@")

    return result
  }

  export async function resolve(prompt: string, basePath: string, name: string) {
    const resolvedLinks = await resolveLinks(prompt, basePath, name)
    return resolveBashCommands(resolvedLinks, basePath, name)
  }

  export const PromptResolveError = NamedError.create(
    "PromptResolveError",
    z.object({
      name: z.string(),
      reference: z.string(),
      error: z.string(),
    }),
  )
}
