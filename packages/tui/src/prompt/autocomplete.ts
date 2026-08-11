import type { KeymapCommand } from "@opencode-ai/plugin/tui/context"
import path from "path"
import { displaySlice, promptOffsetWidth } from "./display"
import { parseSlashHead } from "./parse"

export function slashArgumentAutocomplete(value: string, offset: number, commands: readonly KeymapCommand[]) {
  const beforeCursor = displaySlice(value, 0, offset)
  const head = parseSlashHead(beforeCursor, /\s/)
  if (!head || head.end === beforeCursor.length) return

  const autocomplete = commands.find(
    (command) =>
      command.slash?.autocomplete &&
      (command.slash.name === head.name || command.slash.aliases?.includes(head.name) === true),
  )?.slash?.autocomplete
  if (!autocomplete) return

  return {
    type: autocomplete,
    index: promptOffsetWidth(beforeCursor.slice(0, head.end + 1)),
  }
}

export function directoryAutocompleteSearch(query: string, directory: string, home: string) {
  if (query === "~" || query.startsWith("~/")) {
    return {
      directory: home,
      prefix: "~/",
      query: query === "~" ? "" : query.slice(2),
    }
  }

  const parts = query.split("/")
  const parents = parts.findIndex((part) => part !== "..")
  const count = parents === -1 ? parts.length : parents
  if (count > 0) {
    const prefix = "../".repeat(count)
    return {
      directory: path.resolve(directory, prefix),
      prefix,
      query: parts.slice(count).join("/"),
    }
  }

  return { directory, prefix: "", query }
}

export function directoryAutocompleteResultValue(
  directory: string,
  search: ReturnType<typeof directoryAutocompleteSearch>,
) {
  return (search.prefix || "./") + directory.replace(/^[\\/]+/, "")
}

export function directoryAutocompleteExactValue(value: string, search: ReturnType<typeof directoryAutocompleteSearch>) {
  if (!value || !search.prefix || search.query) return
  return value
}

export function directoryRecentValue(directory: string, home: string) {
  const relative = path.relative(home, directory)
  if (!relative) return "~"
  if (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
    return "~/" + relative.split(path.sep).join("/")
  return directory
}
