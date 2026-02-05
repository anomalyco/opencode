import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { mergeDeep, pipe } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "@opencode-ai/util/error"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { Bus } from "@/bus"
import { ConfigMarkdown } from "./markdown"
import { Log } from "../util/log"
import { Info, Command, Agent } from "./schema"
import type { Info as InfoType, Command as CommandType, Agent as AgentType } from "./schema"
import { constants, existsSync } from "fs"

const log = Log.create({ service: "config" })

// --- Error types ---

export const JsonError = NamedError.create(
  "ConfigJsonError",
  z.object({
    path: z.string(),
    message: z.string().optional(),
  }),
)

export const ConfigDirectoryTypoError = NamedError.create(
  "ConfigDirectoryTypoError",
  z.object({
    path: z.string(),
    dir: z.string(),
    suggestion: z.string(),
  }),
)

export const InvalidError = NamedError.create(
  "ConfigInvalidError",
  z.object({
    path: z.string(),
    issues: z.custom<z.core.$ZodIssue[]>().optional(),
    message: z.string().optional(),
  }),
)

// --- Utility helpers ---

export function rel(item: string, patterns: string[]) {
  for (const pattern of patterns) {
    const index = item.indexOf(pattern)
    if (index === -1) continue
    return item.slice(index + pattern.length)
  }
}

export function trim(file: string) {
  const ext = path.extname(file)
  return ext.length ? file.slice(0, -ext.length) : file
}

// --- File loading ---

export async function loadFile(filepath: string): Promise<InfoType> {
  log.info("loading", { path: filepath })
  let text = await Bun.file(filepath)
    .text()
    .catch((err: any) => {
      if (err.code === "ENOENT") return
      throw new JsonError({ path: filepath }, { cause: err })
    })
  if (!text) return {}
  return load(text, filepath)
}

export async function load(text: string, configFilepath: string) {
  const original = text
  text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || ""
  })

  const fileMatches = text.match(/\{file:[^}]+\}/g)
  if (fileMatches) {
    const configDir = path.dirname(configFilepath)
    const lines = text.split("\n")

    for (const match of fileMatches) {
      const lineIndex = lines.findIndex((line) => line.includes(match))
      if (lineIndex !== -1 && lines[lineIndex].trim().startsWith("//")) {
        continue // Skip if line is commented
      }
      let filePath = match.replace(/^\{file:/, "").replace(/\}$/, "")
      if (filePath.startsWith("~/")) {
        filePath = path.join(os.homedir(), filePath.slice(2))
      }
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
      const fileContent = (
        await Bun.file(resolvedPath)
          .text()
          .catch((error: any) => {
            const errMsg = `bad file reference: "${match}"`
            if (error.code === "ENOENT") {
              throw new InvalidError(
                {
                  path: configFilepath,
                  message: errMsg + ` ${resolvedPath} does not exist`,
                },
                { cause: error },
              )
            }
            throw new InvalidError({ path: configFilepath, message: errMsg }, { cause: error })
          })
      ).trim()
      // escape newlines/quotes, strip outer quotes
      text = text.replace(match, JSON.stringify(fileContent).slice(1, -1))
    }
  }

  const errors: JsoncParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    const lines = text.split("\n")
    const errorDetails = errors
      .map((e) => {
        const beforeOffset = text.substring(0, e.offset).split("\n")
        const line = beforeOffset.length
        const column = beforeOffset[beforeOffset.length - 1].length + 1
        const problemLine = lines[line - 1]

        const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
        if (!problemLine) return error

        return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
      })
      .join("\n")

    throw new JsonError({
      path: configFilepath,
      message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
    })
  }

  const parsed = Info.safeParse(data)
  if (parsed.success) {
    if (!parsed.data.$schema) {
      parsed.data.$schema = "https://opencode.ai/config.json"
      // Write the $schema to the original text to preserve variables like {env:VAR}
      const updated = original.replace(/^\s*\{/, '{\n  "$schema": "https://opencode.ai/config.json",')
      await Bun.write(configFilepath, updated).catch((e: any) => { log.warn("Failed to write config schema", { path: configFilepath, error: e }) })
    }
    const data = parsed.data
    if (data.plugin) {
      for (let i = 0; i < data.plugin.length; i++) {
        const plugin = data.plugin[i]
        try {
          data.plugin[i] = import.meta.resolve!(plugin, configFilepath)
        } catch (err) {
          log.debug("Plugin resolution failed", { plugin, error: err })
        }
      }
    }
    return data
  }

  throw new InvalidError({
    path: configFilepath,
    issues: parsed.error.issues,
  })
}

// --- JSONC patching ---

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function patchJsonc(input: string, patch: unknown, jsonPath: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, jsonPath, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => {
    if (value === undefined) return result
    return patchJsonc(result, value, [...jsonPath, key])
  }, input)
}

export function parseConfig(text: string, filepath: string): InfoType {
  const errors: JsoncParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    const lines = text.split("\n")
    const errorDetails = errors
      .map((e) => {
        const beforeOffset = text.substring(0, e.offset).split("\n")
        const line = beforeOffset.length
        const column = beforeOffset[beforeOffset.length - 1].length + 1
        const problemLine = lines[line - 1]

        const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
        if (!problemLine) return error

        return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
      })
      .join("\n")

    throw new JsonError({
      path: filepath,
      message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
    })
  }

  const parsed = Info.safeParse(data)
  if (parsed.success) return parsed.data

  throw new InvalidError({
    path: filepath,
    issues: parsed.error.issues,
  })
}

export function globalConfigFile() {
  const candidates = ["opencode.jsonc", "opencode.json", "config.json"].map((file) =>
    path.join(Global.Path.config, file),
  )
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

// --- Global config loading (with legacy migration) ---

export const global = lazy(async () => {
  let result: InfoType = pipe(
    {},
    mergeDeep(await loadFile(path.join(Global.Path.config, "config.json"))),
    mergeDeep(await loadFile(path.join(Global.Path.config, "opencode.json"))),
    mergeDeep(await loadFile(path.join(Global.Path.config, "opencode.jsonc"))),
  )

  const legacy = path.join(Global.Path.config, "config")
  if (existsSync(legacy)) {
    await import(pathToFileURL(legacy).href, {
      with: {
        type: "toml",
      },
    })
      .then(async (mod: any) => {
        const { provider, model, ...rest } = mod.default
        if (provider && model) result.model = `${provider}/${model}`
        result["$schema"] = "https://opencode.ai/config.json"
        result = mergeDeep(result, rest)
        await Bun.write(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
        await fs.unlink(legacy)
      })
      .catch((e: any) => { log.debug("Legacy config import skipped", { error: e }) })
  }

  return result
})

// --- Directory scanning: commands, agents, modes ---

const COMMAND_GLOB = new Bun.Glob("{command,commands}/**/*.md")
export async function loadCommand(dir: string) {
  const result: Record<string, CommandType> = {}
  for await (const item of COMMAND_GLOB.scan({
    absolute: true,
    followSymlinks: true,
    dot: true,
    cwd: dir,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err: any) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse command ${item}`
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load command", { command: item, err })
      return undefined
    })
    if (!md) continue

    const patterns = ["/.opencode/command/", "/.opencode/commands/", "/command/", "/commands/"]
    const file = rel(item, patterns) ?? path.basename(item)
    const name = trim(file)

    const config = {
      name,
      ...md.data,
      template: md.content.trim(),
    }
    const parsed = Command.safeParse(config)
    if (parsed.success) {
      result[config.name] = parsed.data
      continue
    }
    throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
  }
  return result
}

const AGENT_GLOB = new Bun.Glob("{agent,agents}/**/*.md")
export async function loadAgent(dir: string) {
  const result: Record<string, AgentType> = {}

  for await (const item of AGENT_GLOB.scan({
    absolute: true,
    followSymlinks: true,
    dot: true,
    cwd: dir,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err: any) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse agent ${item}`
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load agent", { agent: item, err })
      return undefined
    })
    if (!md) continue

    const patterns = ["/.opencode/agent/", "/.opencode/agents/", "/agent/", "/agents/"]
    const file = rel(item, patterns) ?? path.basename(item)
    const agentName = trim(file)

    const config = {
      name: agentName,
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Agent.safeParse(config)
    if (parsed.success) {
      result[config.name] = parsed.data
      continue
    }
    throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
  }
  return result
}

const MODE_GLOB = new Bun.Glob("{mode,modes}/*.md")
export async function loadMode(dir: string) {
  const result: Record<string, AgentType> = {}
  for await (const item of MODE_GLOB.scan({
    absolute: true,
    followSymlinks: true,
    dot: true,
    cwd: dir,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err: any) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse mode ${item}`
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load mode", { mode: item, err })
      return undefined
    })
    if (!md) continue

    const config = {
      name: path.basename(item, ".md"),
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Agent.safeParse(config)
    if (parsed.success) {
      result[config.name] = {
        ...parsed.data,
        mode: "primary" as const,
      }
      continue
    }
  }
  return result
}
