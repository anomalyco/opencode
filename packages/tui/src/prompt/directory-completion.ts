import type { KeymapCommand } from "@opencode/plugin/tui/context"
import type { OpenCodeClient } from "@opencode/client"
import { measureEditText, type WidthMethod } from "@opentui/core"
import fuzzysort from "fuzzysort"
import path from "path"
import { parseSlashHead } from "./parse"

export async function directoryAutocomplete(
  file: Pick<OpenCodeClient["file"], "list">,
  location: { directory: string },
  query: string,
  home: string,
) {
  const search = directoryAutocompleteSearch(query, location.directory, home)
  const result = await file.list({ location, path: search.directory })
  const exact = directoryAutocompleteExactValue(query, search)
  return [
    ...(exact ? [{ value: exact, absolute: search.directory }] : []),
    ...result.data
      .filter((item) => item.type === "directory")
      .map((item) => path.resolve(result.location.directory, item.path))
      .filter((absolute) => directoryAutocompleteMatches(path.basename(absolute), search.query))
      .map((absolute) => ({
        value: directoryAutocompleteResultValue(path.basename(absolute) + "/", search),
        absolute,
      })),
  ]
}

export function slashArgumentAutocomplete(
  beforeCursor: string,
  widthMethod: WidthMethod,
  commands: readonly KeymapCommand[],
  autocomplete: ((command: KeymapCommand) => "directory" | undefined) | undefined,
) {
  const head = parseSlashHead(beforeCursor, /\s/)
  if (!head || head.end === beforeCursor.length) return

  const command = commands.find(
    (command) =>
      command.slash?.arguments &&
      (command.slash.name === head.name || command.slash.aliases?.includes(head.name) === true),
  )
  if (!command) return
  const type = autocomplete?.(command)
  if (!type) return

  return {
    type,
    index: measureEditText(beforeCursor.slice(0, head.end + 1), { widthMethod }),
  }
}

export type MentionSearch = { directory: string; prefix: string; fragment: string }

export type MentionEntry = {
  path: string
  absolute: string
  name: string
  directory: boolean
}

export function mentionFileSearch(query: string, directory: string, home: string): MentionSearch | undefined {
  if (!query) return
  const outside = query === "~" || query.startsWith("~/") || query.startsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(query)
  if (!outside) return
  const search = directoryAutocompleteSearch(query, directory, home)
  return { directory: search.directory, prefix: search.prefix, fragment: search.query }
}

export async function mentionAutocomplete(
  file: Pick<OpenCodeClient["file"], "list">,
  location: { directory: string },
  query: string,
  home: string,
  limit = 50,
) {
  const search = mentionFileSearch(query, location.directory, home)
  if (!search) return
  const result = await file.list({ location, path: search.directory })
  const entries = result.data
    .map((item): MentionEntry => {
      // Resolve against the response location, not the listed directory, so the
      // location itself (returned as "./") keeps its real directory name.
      const absolute = path.resolve(result.location.directory, item.path)
      return {
        path: item.path,
        absolute,
        name: path.basename(absolute),
        directory: item.type === "directory",
      }
    })
    .filter((entry) => search.fragment.startsWith(".") || !entry.name.startsWith("."))

  if (!search.fragment) {
    return {
      search,
      entries: entries
        .sort((a, b) => (a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1))
        .slice(0, limit),
    }
  }

  const matches = fuzzysort.go(search.fragment, entries, { key: "name", limit }).map((item) => item.obj)
  fuzzysort.cleanup()
  return { search, entries: matches }
}

export function mentionFileName(prefix: string, absolute: string, directory: boolean) {
  return prefix + path.basename(absolute) + (directory ? "/" : "")
}

export function directoryAutocompleteSearch(query: string, directory: string, home: string) {
  if (query === "~") return { directory: home, prefix: "~/", query: "" }
  if (query.startsWith("~/")) return directorySearch(query.slice(2), home, "~/")
  if (/^(?:\.\.\/)*\.\.$/.test(query))
    return { directory: path.resolve(directory, query), prefix: query + "/", query: "" }
  if (query.startsWith("/")) return directorySearch(query.slice(1), path.parse(directory).root, "/")
  return directorySearch(query, directory, "")
}

function directorySearch(query: string, root: string, prefix: string) {
  const separator = query.lastIndexOf("/")
  if (separator === -1) return { directory: root, prefix, query }
  const parent = query.slice(0, separator + 1)
  return {
    directory: path.resolve(root, parent),
    prefix: prefix + parent,
    query: query.slice(separator + 1),
  }
}

export function directoryAutocompleteResultValue(
  directory: string,
  search: ReturnType<typeof directoryAutocompleteSearch>,
) {
  return search.prefix + directory.replace(/^[\\/]+/, "")
}

export function directoryAutocompleteExactValue(value: string, search: ReturnType<typeof directoryAutocompleteSearch>) {
  if (!value || !search.prefix || search.query) return
  return value
}

export function directoryAutocompleteMatches(directory: string, query: string) {
  const value = directory.replace(/^[\\/]+/, "")
  if (!query && value.startsWith(".")) return false
  return value.toLowerCase().startsWith(query.toLowerCase())
}

export function directoryRecentValue(directory: string, home: string) {
  const relative = path.relative(home, directory)
  if (!relative) return "~"
  if (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
    return "~/" + relative.split(path.sep).join("/")
  return directory
}
