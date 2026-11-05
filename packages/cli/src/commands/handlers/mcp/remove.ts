import { EOL } from "node:os"
import path from "node:path"
import { readFile, realpath, writeFile } from "node:fs/promises"
import { autocomplete, confirm, log } from "@clack/prompts"
import { Effect, Option } from "effect"
import { applyEdits, createScanner, findNodeAtLocation, parse, parseTree, type ParseError } from "jsonc-parser"
import { Global } from "@opencode/util/global"
import { ConfigFile } from "@opencode/util/config-file"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(
  Commands.commands.mcp.commands.remove,
  Effect.fn("cli.mcp.remove")(function* (input) {
    if (input.local && input.global)
      return yield* Effect.fail(new Error("Provide either --local or --global, not both"))
    const name = Option.getOrUndefined(input.name)
    if (!name) yield* requireInteractive("Pass an MCP server name when running without an interactive terminal")
    const global = yield* Global.Service
    const inventory = yield* Effect.tryPromise({
      try: () =>
        configuredServers(process.cwd(), global.config, input.local ? "local" : input.global ? "global" : undefined),
      catch: (error) => error,
    })
    inventory.warnings.forEach((message) => log.warn(`Skipping config: ${message}`))
    const entries = inventory.entries.filter((entry) => !name || entry.name === name)
    if (!entries.length) {
      if (name) return yield* Effect.fail(new Error(`MCP server "${name}" is not configured in the selected scope`))
      process.stdout.write(`No configured MCP servers found${EOL}`)
      return
    }
    if (entries.length > 1)
      yield* requireInteractive(
        `MCP server is ambiguous. Use --local or --global to narrow the selection, or edit its configuration file: ${entries.map((entry) => entry.file).join(", ")}`,
      )
    const selected =
      name && entries.length === 1
        ? entries[0]
        : yield* prompt(() =>
            autocomplete({
              message: "Which MCP server would you like to remove?",
              maxItems: 10,
              options: entries.map((entry) => ({
                value: entry,
                label: `${entry.scope} · ${entry.name}`,
                hint: `${entry.file} · ${entry.keys.join(".")}`,
              })),
            }),
          )
    if (!input.yes) {
      yield* requireInteractive("Pass --yes to confirm removal when running without an interactive terminal")
      const accepted = yield* prompt(() =>
        confirm({
          message: `Remove "${selected.name}" from ${selected.file}?${selected.scope === "Global" ? " This affects all projects." : selected.scope === "Inherited" ? " This affects projects inheriting this file." : ""}`,
          initialValue: false,
        }),
      )
      if (!accepted) return
    }
    const removed = yield* Effect.tryPromise({
      try: () => removeServer(selected.file, selected.keys),
      catch: (error) => error,
    })
    process.stdout.write(
      removed
        ? `MCP server "${selected.name}" removed from ${selected.file}${EOL}`
        : `MCP server "${selected.name}" is no longer configured in ${selected.file}${EOL}`,
    )
  }, handlePromptErrors),
)

export async function configuredServers(directory: string, global: string, scope?: "local" | "global") {
  const current = await realpath(directory)
  const globalDirectory = await realpath(global).catch(() => path.resolve(global))
  const parents = (item: string): string[] =>
    item === path.dirname(item) ? [item] : [item, ...parents(path.dirname(item))]
  const sources = [
    ...(scope === "local" ? [] : [{ directory: globalDirectory, scope: "Global" }]),
    ...(scope === "global" || current === globalDirectory
      ? []
      : parents(current)
          .filter((item) => item !== globalDirectory)
          .map((item) => ({ directory: item, scope: item === current ? "Project" : "Inherited" }))),
  ]
  const entries: { file: string; scope: string; name: string; keys: string[] }[] = []
  const warnings: string[] = []
  for (const source of sources) {
    for (const name of source.scope === "Global"
      ? ConfigFile.names
      : [...ConfigFile.names, ...ConfigFile.names.map((name) => path.join(".opencode", name))]) {
      const file = path.join(source.directory, name)
      // A global config must not reappear as an inherited project config through a symlink.
      const resolved = await realpath(file).catch(() => file)
      if (
        source.scope !== "Global" &&
        (resolved === globalDirectory || resolved.startsWith(globalDirectory + path.sep))
      )
        continue
      try {
        const config = await readServers(file)
        entries.push(...config.keys.map((keys) => ({ file, scope: source.scope, name: keys[keys.length - 1], keys })))
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue
        warnings.push(`${file}: ${errorMessage(error)}`)
      }
    }
  }
  return { entries, warnings }
}

export async function removeServer(file: string, keys: string[]) {
  const config = await readServers(file)
  if (
    !config.keys.some(
      (candidate) => candidate.length === keys.length && candidate.every((key, index) => key === keys[index]),
    )
  )
    return false
  // jsonc-parser's modify() also removes comments belonging to the next property.
  // Delete just the property and its separator so all comments stay in the file.
  const tree = parseTree(config.text)
  if (!tree) throw new Error(`Invalid JSON configuration: ${file}`)
  const property = findNodeAtLocation(tree, keys)?.parent
  if (!property) return false
  const scanner = createScanner(config.text, true)
  scanner.setPosition(property.offset + property.length)
  scanner.scan()
  const properties = property.parent?.children ?? []
  const previous = properties[properties.indexOf(property) - 1]
  if (config.text[scanner.getTokenOffset()] !== "," && previous) {
    scanner.setPosition(previous.offset + previous.length)
    scanner.scan()
  }
  const separator =
    config.text[scanner.getTokenOffset()] === "," ? [{ offset: scanner.getTokenOffset(), length: 1, content: "" }] : []
  await writeFile(
    file,
    applyEdits(config.text, [{ offset: property.offset, length: property.length, content: "" }, ...separator]),
  )
  return true
}

async function readServers(file: string) {
  const text = await readFile(file, "utf8")
  const errors: ParseError[] = []
  const config: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !record(config)) throw new Error(`Invalid JSON configuration: ${file}`)
  if (config.mcp === undefined) return { text, keys: [] }
  if (!record(config.mcp)) throw new Error(`Invalid MCP configuration: ${file}`)
  const keys = Object.entries(config.mcp).flatMap(([name, value]) => {
    // The runtime reserves these names only when they are not legacy server objects.
    const legacy = record(value) && (value.type === "local" || value.type === "remote")
    if (name === "timeout" && !legacy) return []
    if (name === "servers" && !legacy) {
      if (!record(value)) throw new Error(`Invalid MCP servers configuration: ${file}`)
      return Object.keys(value).map((name) => ["mcp", "servers", name])
    }
    if (!record(value)) throw new Error(`Invalid MCP server "${name}": ${file}`)
    return [["mcp", name]]
  })
  return { text, keys }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
