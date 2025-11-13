import path from "path"
import fs from "fs/promises"
import { constants } from "fs"
import { randomUUID } from "crypto"
import {
  modify,
  applyEdits,
  type ModificationOptions,
  parse as parseJsonc,
  type ParseError,
  printParseErrorCode,
} from "jsonc-parser"
import { Log } from "@/util/log"
import type { Config } from "./config"
import type { ConfigDiff } from "./diff"
import { isDeepEqual } from "remeda"

const log = Log.create({ service: "config.write" })

interface WriteConfigOptions {
  diff?: ConfigDiff
  previous?: Config.Info
}

export async function writeConfigFile(
  filepath: string,
  newConfig: Config.Info,
  existingContent: string | null,
  options?: WriteConfigOptions,
): Promise<void> {
  const file = Bun.file(filepath)
  const isJsonc = filepath.endsWith(".jsonc") || filepath.endsWith(".json")

  if (!existingContent || !(await file.exists())) {
    const content = JSON.stringify(newConfig, null, 2) + "\n"
    await writeFileAtomically(filepath, content)
    return
  }

  if (isJsonc) {
    const updated = applyIncrementalUpdates(existingContent, newConfig, options)
    validateJsonc(updated)
    await writeFileAtomically(filepath, updated)
    return
  }

  const content = JSON.stringify(newConfig, null, 2) + "\n"
  await writeFileAtomically(filepath, content)
}

type UpdateInstruction = { path: (string | number)[]; value: unknown }
type UnknownRecord = Record<string, unknown>
const nestedRecordKeys = new Set([
  "provider",
  "mcp",
  "agent",
  "command",
  "permission",
  "formatter",
  "lsp",
  "tools",
  "mode",
])
const diffKeyToConfigKey: Record<string, string[]> = {
  provider: ["provider"],
  mcp: ["mcp"],
  lsp: ["lsp"],
  formatter: ["formatter"],
  watcher: ["watcher"],
  plugin: ["plugin"],
  agent: ["agent"],
  command: ["command"],
  permission: ["permission"],
  tools: ["tools"],
  instructions: ["instructions"],
  share: ["share"],
  autoshare: ["autoshare"],
  theme: ["theme"],
  model: ["model"],
  small_model: ["small_model"],
  disabled_providers: ["disabled_providers"],
}

function applyIncrementalUpdates(content: string, newConfig: Config.Info, options?: WriteConfigOptions) {
  const formattingOptions: ModificationOptions = {
    formattingOptions: {
      tabSize: 2,
      insertSpaces: true,
      eol: "\n",
    },
  }

  let currentContent = content

  if (!options?.previous) {
    for (const [key, value] of Object.entries(newConfig)) {
      const edits = modify(currentContent, [key], value, formattingOptions)
      currentContent = applyEdits(currentContent, edits)
    }
    return currentContent
  }

  const instructions = buildUpdateInstructions(newConfig, options.previous, options.diff)

  if (instructions.length === 0) {
    return currentContent
  }

  for (const instruction of instructions) {
    const edits = modify(currentContent, instruction.path, instruction.value, formattingOptions)
    currentContent = applyEdits(currentContent, edits)
  }

  return currentContent
}

function buildUpdateInstructions(
  newConfig: Config.Info,
  previous: Config.Info,
  diff?: ConfigDiff,
): UpdateInstruction[] {
  const updateKeys = new Set<string>()
  if (diff) {
    for (const [diffKey, configKeys] of Object.entries(diffKeyToConfigKey)) {
      const flag = diff[diffKey as keyof ConfigDiff]
      if (!flag) continue
      for (const configKey of configKeys) {
        updateKeys.add(configKey)
      }
    }
  }

  const allKeys = new Set<string>([...Object.keys(previous ?? {}), ...Object.keys(newConfig)])
  for (const key of allKeys) {
    if (updateKeys.has(key)) continue
    const prevValue = (previous as UnknownRecord)[key]
    const nextValue = (newConfig as UnknownRecord)[key]
    if (!isDeepEqual(prevValue, nextValue)) {
      updateKeys.add(key)
    }
  }

  const instructions: UpdateInstruction[] = []
  for (const key of updateKeys) {
    const nextHasKey = hasOwn(newConfig, key)
    const prevValue = (previous as UnknownRecord)[key]
    const nextValue = nextHasKey ? (newConfig as UnknownRecord)[key] : undefined

    if (!nextHasKey) {
      instructions.push({ path: [key], value: undefined })
      continue
    }

    if (nextValue === undefined) {
      instructions.push({ path: [key], value: undefined })
      continue
    }

    if (shouldUseNestedUpdates(key, prevValue, nextValue)) {
      const nestedInstructions = buildNestedInstructions(
        key,
        prevValue as UnknownRecord | undefined,
        nextValue as UnknownRecord | undefined,
        diff,
      )
      instructions.push(...nestedInstructions)
      continue
    }

    instructions.push({ path: [key], value: nextValue })
  }

  return sortInstructions(instructions)
}

function buildNestedInstructions(
  key: string,
  previousValue: Record<string, unknown> | undefined,
  nextValue: Record<string, unknown> | undefined,
  diff?: ConfigDiff,
): UpdateInstruction[] {
  const instructions: UpdateInstruction[] = []
  if (!previousValue && !nextValue) {
    return instructions
  }

  const diffChildKeys = new Set<string>()
  if (key === "provider" && diff?.providerKeys) {
    for (const bucket of Object.values(diff.providerKeys)) {
      bucket.forEach((child) => diffChildKeys.add(child))
    }
  }
  if (key === "mcp" && diff?.mcpKeys) {
    for (const bucket of Object.values(diff.mcpKeys)) {
      bucket.forEach((child) => diffChildKeys.add(child))
    }
  }

  const previousKeys = Object.keys(previousValue ?? {})
  const nextKeys = Object.keys(nextValue ?? {})
  for (const name of [...previousKeys, ...nextKeys]) {
    diffChildKeys.add(name)
  }

  for (const childKey of diffChildKeys) {
    const nextHasKey = hasOwn(nextValue, childKey)
    const prevChild = previousValue ? (previousValue as UnknownRecord)[childKey] : undefined
    if (!nextHasKey) {
      if (typeof prevChild !== "undefined") {
        instructions.push({ path: [key, childKey], value: undefined })
      }
      continue
    }
    const nextChild = (nextValue as UnknownRecord)[childKey]
    if (!isDeepEqual(prevChild, nextChild)) {
      instructions.push({ path: [key, childKey], value: nextChild })
    }
  }

  return instructions
}

function shouldUseNestedUpdates(key: string, previousValue: unknown, nextValue: unknown) {
  if (!nestedRecordKeys.has(key)) return false
  if (typeof previousValue !== "object" || previousValue === null) return false
  if (typeof nextValue !== "object" || nextValue === null) return false
  return true
}

function hasOwn(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false
  return Object.prototype.hasOwnProperty.call(value, key)
}

function sortInstructions(instructions: UpdateInstruction[]): UpdateInstruction[] {
  return instructions.sort((a, b) => {
    if (a.path.length !== b.path.length) {
      return a.path.length - b.path.length
    }
    const aPath = a.path.join(".")
    const bPath = b.path.join(".")
    if (aPath === bPath) return 0
    return aPath < bPath ? -1 : 1
  })
}

function validateJsonc(content: string) {
  const errors: ParseError[] = []
  parseJsonc(content, errors, { allowTrailingComma: true })

  if (errors.length === 0) {
    return
  }

  const details = errors
    .map((error) => {
      const code = printParseErrorCode(error.error)
      return `${code} at ${error.offset}`
    })
    .join("; ")

  throw new SyntaxError(`Invalid JSONC produced while persisting config: ${details}`)
}

export async function writeFileAtomically(filepath: string, content: string): Promise<void> {
  const directory = path.dirname(filepath)
  const tempName = `${path.basename(filepath)}.${randomUUID()}.tmp`
  const tempPath = path.join(directory, tempName)
  await fs.mkdir(directory, { recursive: true })
  const handle = await fs.open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600)
  await handle.writeFile(content, "utf8")
  await handle.sync()
  await handle.close()
  await fs.rename(tempPath, filepath).catch(async (error) => {
    await fs.unlink(tempPath).catch(() => {})
    throw error
  })
  await syncDirectory(directory)
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return
  const handle = await fs.open(directory, constants.O_RDONLY).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "EISDIR") return
    if (error?.code === "ENOENT") return
    log.warn("directory sync skipped", { directory, error: String(error) })
    return
  })
  if (!handle) return

  await handle.sync().catch((error: NodeJS.ErrnoException) => {
    log.warn("directory sync failed", { directory, error: String(error) })
  })
  await handle.close()
}
