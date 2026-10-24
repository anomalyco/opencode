import path from "node:path"
import { fileURLToPath } from "node:url"
import type { LanguageDefinition } from "@opencode/plugin/tui/context"
import { addDefaultParsers, getTreeSitterClient, type FiletypeParserOptions } from "@opentui/core"
import { isDeepEqual } from "remeda"
import { createSignal } from "solid-js"
import parsers from "../parsers-config"
import { setRegisteredExtensions } from "./filetype"

type Source = "plugins" | "config"

// Later sources win, so cli.json stays the final authority over plugin contributions.
const precedence: readonly Source[] = ["plugins", "config"]
const sources: Record<Source, readonly LanguageDefinition[]> = { plugins: [], config: [] }
// A signal, so memoized filetype lookups follow plugins that register after the first render.
const [extensions, setExtensions] = createSignal<ReadonlyMap<string, string>>(new Map())
setRegisteredExtensions((extension) => extensions().get(extension))
let registered = new Map<string, FiletypeParserOptions>()

/** Replaces the languages one source contributes. Their sources must already be passed through `resolve`. */
export function set(source: Source, definitions: readonly LanguageDefinition[]) {
  sources[source] = definitions
  const effective = [
    ...new Map(precedence.flatMap((name) => sources[name]).map((definition) => [definition.id, definition])).values(),
  ]
  setExtensions(
    new Map(
      effective.flatMap((definition) =>
        (definition.extensions ?? []).map((extension) => [extension, definition.id] as const),
      ),
    ),
  )
  const next = new Map(
    effective.map((definition): [string, FiletypeParserOptions] => [
      definition.id,
      {
        filetype: definition.id,
        wasm: definition.wasm,
        queries: {
          highlights: [...definition.highlights],
          injections: definition.injections && [...definition.injections],
        },
      },
    ]),
  )
  const changed: FiletypeParserOptions[] = [
    ...[...next.values()].filter((parser) => !isDeepEqual(parser, registered.get(parser.filetype))),
    // OpenTUI cannot unregister a parser, so a removed override restores the built-in it replaced.
    ...[...registered.keys()]
      .filter((id) => !next.has(id))
      .flatMap((id) => parsers.parsers.find((parser) => parser.filetype === id) ?? []),
  ]
  registered = next
  if (changed.length === 0) return
  // Defaults reach a client that has not initialized yet and every worker restart; a running worker needs them now.
  addDefaultParsers(changed)
  const client = getTreeSitterClient()
  if (client.isInitialized()) changed.forEach((parser) => client.addFiletypeParser(parser))
}

/**
 * Rewrites sources into the http(s) URLs and absolute paths the parser worker can load. Relative paths resolve
 * against `directory`, and are rejected without one.
 */
export function resolve(definition: LanguageDefinition, directory?: string): LanguageDefinition {
  const source = (value: string) => {
    if (value.startsWith("http://") || value.startsWith("https://")) return value
    if (value.startsWith("file:")) return fileURLToPath(value)
    if (path.isAbsolute(value)) return value
    if (directory) return path.resolve(directory, value)
    throw new Error(`Language ${definition.id}: ${value} must be a URL or an absolute path`)
  }
  return {
    ...definition,
    wasm: source(definition.wasm),
    highlights: definition.highlights.map(source),
    injections: definition.injections?.map(source),
  }
}

export * as Languages from "./languages"
