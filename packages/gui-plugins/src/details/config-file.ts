import type { ConfigEntry } from "@opencode/client"
import { Predicate } from "effect"

type ConfigInfo = Extract<ConfigEntry, { type: "document" }>["info"]

/**
 * The configuration file that holds a service's entries: the last one that lists any, else the last one that sets the
 * service, else the first. An empty `"mcp": {}` in a project file does not hide the servers the global file lists.
 */
export function serviceConfigFile(entries: readonly ConfigEntry[], service: "mcp" | "plugins" | "skills" | "lsp") {
  const documents = configDocuments(entries)

  return (
    documents.findLast((document) => lists(document.info, service)) ??
    documents.findLast((document) => document.info[service] !== undefined) ??
    documents.at(0)
  )?.path
}

/**
 * The global configuration directory, else the location itself. The server lists a `directory` entry for each config
 * root, the global one before any project's, and a project root is always a `.opencode` folder. So the first root is
 * the global one unless it is a project's, which means global configuration is off. A project config in an ancestor of
 * the worktree is not mistaken for it.
 */
export function globalConfigDirectory(entries: readonly ConfigEntry[], directory: string) {
  const root = entries.find((entry) => entry.type === "directory")

  return root && !/[\\/]\.opencode[\\/]?$/.test(root.path) ? root.path.replace(/[\\/]+$/, "") : directory
}

function configDocuments(entries: readonly ConfigEntry[]) {
  return entries.flatMap((entry) =>
    entry.type === "document" && entry.path !== undefined && /\.jsonc?$/.test(entry.path)
      ? [{ path: entry.path, info: entry.info }]
      : [],
  )
}

function lists(info: ConfigInfo, service: "mcp" | "plugins" | "skills" | "lsp") {
  if (service === "mcp") return Object.keys(info.mcp?.servers ?? {}).length > 0

  if (service === "lsp")
    return info.lsp !== undefined && !Predicate.isBoolean(info.lsp) && Object.keys(info.lsp).length > 0

  return (info[service]?.length ?? 0) > 0
}
