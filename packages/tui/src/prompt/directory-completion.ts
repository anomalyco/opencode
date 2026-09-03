import type { KeymapCommand } from "@opencode-ai/plugin/tui/context"
import type { OpenCodeClient } from "@opencode-ai/client"
import path from "path"
import { displaySlice, promptOffsetWidth } from "./display"
import { parseSlashHead } from "./parse"

export async function directoryAutocomplete(
  file: Pick<OpenCodeClient["file"], "list">,
  location: { directory: string; workspace?: string },
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
  value: string,
  offset: number,
  commands: readonly KeymapCommand[],
  autocomplete: ((command: KeymapCommand) => "directory" | undefined) | undefined,
) {
  const beforeCursor = displaySlice(value, 0, offset)
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
    index: promptOffsetWidth(beforeCursor.slice(0, head.end + 1)),
  }
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
