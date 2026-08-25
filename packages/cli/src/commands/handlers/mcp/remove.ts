import { EOL } from "node:os"
import path from "node:path"
import { readFile, rename, stat, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { Global } from "@opencode-ai/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.mcp.commands.remove,
  Effect.fn("cli.mcp.remove")(function* (input) {
    const global = yield* Global.Service
    const project = yield* Effect.promise(() => existingConfigPaths(process.cwd()))
    const candidates = [...project, yield* Effect.promise(() => resolveConfigPath(global.config))]
    const removed: string[] = []
    for (const configPath of candidates) {
      const found = yield* Effect.promise(() => removeMcpConfig(configPath, input.name))
      if (found) removed.push(configPath)
    }
    process.stdout.write(
      removed.length
        ? `MCP server "${input.name}" removed from ${removed.join(", ")}${EOL}`
        : `MCP server "${input.name}" is not configured${EOL}`,
    )
  }),
)

async function existingConfigPaths(directory: string) {
  const candidates = [
    path.join(directory, "opencode.json"),
    path.join(directory, "opencode.jsonc"),
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
  ]
  const existing: string[] = []
  for (const candidate of candidates) {
    if (await stat(candidate).then((info) => info.isFile(), () => false)) existing.push(candidate)
  }
  return existing
}

async function resolveConfigPath(directory: string) {
  const candidates = [
    path.join(directory, "opencode.json"),
    path.join(directory, "opencode.jsonc"),
  ]
  for (const candidate of candidates) {
    if (await stat(candidate).then((info) => info.isFile(), () => false)) return candidate
  }
  return candidates[0]
}

export async function removeMcpConfig(configPath: string, name: string) {
  const text = await readFile(configPath, "utf8").catch((error) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (text === undefined) return false
  const errors: ParseError[] = []
  const config: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof config !== "object" || config === null || Array.isArray(config))
    throw new Error(`Invalid configuration: ${configPath}`)
  const mcp = "mcp" in config ? config.mcp : undefined
  if (mcp === undefined) return false
  if (typeof mcp !== "object" || mcp === null || Array.isArray(mcp))
    throw new Error(`Invalid mcp configuration: ${configPath}`)
  // Servers live under mcp.servers in the v2 shape; older global configs keep them flat under mcp
  if ("servers" in mcp) {
    const servers = mcp.servers
    if (typeof servers !== "object" || servers === null || Array.isArray(servers))
      throw new Error(`Invalid mcp servers configuration: ${configPath}`)
    if (!(name in servers)) return false
    await writeRemoval(configPath, text, ["mcp", "servers", name])
    return true
  }
  if (!(name in mcp)) return false
  await writeRemoval(configPath, text, ["mcp", name])
  return true
}

async function writeRemoval(configPath: string, text: string, key: (string | number)[]) {
  // Passing undefined as the value makes jsonc-parser emit a delete edit for the property
  const updated = applyEdits(
    text,
    modify(text, key, undefined, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    }),
  )
  const temporary = configPath + ".tmp"
  await writeFile(temporary, updated.endsWith("\n") ? updated : updated + "\n", { mode: 0o600 })
  await rename(temporary, configPath)
}
