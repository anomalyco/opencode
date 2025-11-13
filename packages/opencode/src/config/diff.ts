import { isDeepEqual } from "remeda"
import type { Config } from "./config"

export interface ConfigDiff {
  provider?: boolean
  providerKeys?: { added: string[]; removed: string[]; modified: string[] }
  mcp?: boolean
  mcpKeys?: { added: string[]; removed: string[]; modified: string[] }
  lsp?: boolean
  formatter?: boolean
  watcher?: boolean
  plugin?: boolean
  pluginAdded?: string[]
  pluginRemoved?: string[]
  agent?: boolean
  command?: boolean
  permission?: boolean
  tools?: boolean
  instructions?: boolean
  share?: boolean
  autoshare?: boolean
  theme?: boolean
  model?: boolean
  small_model?: boolean
  disabled_providers?: boolean
}

function computeKeysChanged(
  before: Record<string, any> | undefined,
  after: Record<string, any> | undefined,
): { added: string[]; removed: string[]; modified: string[] } {
  const beforeKeys = Object.keys(before ?? {})
  const afterKeys = Object.keys(after ?? {})

  const added = afterKeys.filter((k) => !beforeKeys.includes(k))
  const removed = beforeKeys.filter((k) => !afterKeys.includes(k))
  const modified = afterKeys.filter((k) => {
    if (!beforeKeys.includes(k)) return false
    return !isDeepEqual(before?.[k], after?.[k])
  })

  return { added, removed, modified }
}

export function computeDiff(before: Config.Info, after: Config.Info): ConfigDiff {
  const diff: ConfigDiff = {}

  if (!isDeepEqual(before.provider, after.provider)) {
    diff.provider = true
    diff.providerKeys = computeKeysChanged(before.provider, after.provider)
  }

  if (!isDeepEqual(before.mcp, after.mcp)) {
    diff.mcp = true
    diff.mcpKeys = computeKeysChanged(before.mcp, after.mcp)
  }

  if (!isDeepEqual(before.lsp, after.lsp)) {
    diff.lsp = true
  }

  if (!isDeepEqual(before.formatter, after.formatter)) {
    diff.formatter = true
  }

  if (!isDeepEqual(before.watcher, after.watcher)) {
    diff.watcher = true
  }

  if (!isDeepEqual(before.plugin, after.plugin)) {
    diff.plugin = true
    const beforePlugins = before.plugin ?? []
    const afterPlugins = after.plugin ?? []
    diff.pluginAdded = afterPlugins.filter((p) => !beforePlugins.includes(p))
    diff.pluginRemoved = beforePlugins.filter((p) => !afterPlugins.includes(p))
  }

  if (!isDeepEqual(before.agent, after.agent)) {
    diff.agent = true
  }

  if (!isDeepEqual(before.command, after.command)) {
    diff.command = true
  }

  if (!isDeepEqual(before.permission, after.permission)) {
    diff.permission = true
  }

  if (!isDeepEqual(before.tools, after.tools)) {
    diff.tools = true
  }

  if (!isDeepEqual(before.instructions, after.instructions)) {
    diff.instructions = true
  }

  if (before.share !== after.share) {
    diff.share = true
  }

  if (before.autoshare !== after.autoshare) {
    diff.autoshare = true
  }

  if (before.theme !== after.theme) {
    diff.theme = true
  }

  if (before.model !== after.model) {
    diff.model = true
  }

  if (before.small_model !== after.small_model) {
    diff.small_model = true
  }

  if (!isDeepEqual(before.disabled_providers, after.disabled_providers)) {
    diff.disabled_providers = true
  }

  return diff
}
