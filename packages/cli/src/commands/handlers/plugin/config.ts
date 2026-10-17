import path from "node:path"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { Option, Schema } from "effect"
import { ConfigPlugin } from "@opencode/schema/config/plugin"

const decode = Schema.decodeUnknownOption(Schema.Struct({ plugins: Schema.optional(ConfigPlugin.Plugins) }))

export interface ConfiguredPlugin {
  readonly target: string
  readonly scope: "project" | "global"
  readonly inherited?: boolean
  readonly path: string
  readonly runtime: "server" | "tui"
}

export async function readPluginConfig(file: string) {
  const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (text === undefined)
    return { text: JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2), plugins: [] }
  const errors: ParseError[] = []
  const config = Option.getOrUndefined(decode(parse(text, errors, { allowTrailingComma: true })))
  if (errors.length || !config) throw new Error(`Invalid plugin configuration: ${file}`)
  return { text, plugins: config.plugins ?? [] }
}

export async function writePlugins(file: string, text: string, plugins: readonly ConfigPlugin.Plugin[]) {
  const updated = applyEdits(
    text,
    modify(text, ["plugins"], plugins, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    }),
  )
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file + ".tmp", updated.endsWith("\n") ? updated : updated + "\n", { mode: 0o600 })
  await rename(file + ".tmp", file)
}

export async function configuredPlugins(input: {
  directory: string
  global: string
  cli: string
  scope?: ConfiguredPlugin["scope"]
}) {
  const directory = path.resolve(input.directory)
  const global = path.resolve(input.global)
  const files = [
    ...projectPaths(directory)
      .filter((file) => path.dirname(file) !== global)
      .map((file) => ({
        path: file,
        scope: "project" as const,
        inherited: ![directory, path.join(directory, ".opencode")].includes(path.dirname(file)),
        runtime: "server" as const,
      })),
    ...["opencode.json", "opencode.jsonc"].map((name) => ({
      path: path.join(global, name),
      scope: "global" as const,
      runtime: "server" as const,
    })),
    { path: input.cli, scope: "global" as const, runtime: "tui" as const },
  ].filter((file) => !input.scope || file.scope === input.scope)
  const results = await Promise.all(
    files.map(async (file) => {
      const result = await readPluginConfig(file.path).then(
        (config) => ({ config }),
        (error: Error) => ({ error }),
      )
      if ("error" in result) return { entries: [], warnings: [result.error.message] }
      return {
        entries: [...new Set(result.config.plugins.map(pluginTarget))]
          .filter(
            (target) =>
              !target.startsWith("-") && target !== "*" && !target.endsWith(".*") && !target.startsWith("opencode."),
          )
          .map((target): ConfiguredPlugin => ({ ...file, target })),
        warnings: [],
      }
    }),
  )
  return {
    entries: results
      .flatMap((result) => result.entries)
      .toSorted(
        (a, b) =>
          Number(a.scope === "global") - Number(b.scope === "global") ||
          Number(Boolean(a.inherited)) - Number(Boolean(b.inherited)) ||
          a.target.localeCompare(b.target) ||
          a.path.localeCompare(b.path),
      ),
    warnings: results.flatMap((result) => result.warnings),
  }
}

export function pluginTarget(plugin: ConfigPlugin.Plugin) {
  return typeof plugin === "string" ? plugin : plugin.package
}

function projectPaths(directory: string): string[] {
  return [
    ...["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"].map((name) =>
      path.join(directory, name),
    ),
    ...(path.dirname(directory) === directory ? [] : projectPaths(path.dirname(directory))),
  ]
}
