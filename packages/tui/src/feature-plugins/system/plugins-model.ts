import type { PluginInfo, PluginUpdateInfo, PluginUpdateResult } from "@opencode-ai/client"

type UpdateEntry = PluginUpdateInfo | PluginUpdateResult

export function matchesPluginUpdate(plugin: PluginInfo, update: UpdateEntry) {
  if (plugin.source.type !== update.source.type) return false
  if (plugin.source.type === "package" && update.source.type === "package") {
    return plugin.source.package === update.source.package
  }
  if (plugin.source.type === "local" && update.source.type === "local") return plugin.source.path === update.source.path
  return plugin.id === update.name
}

export function pluginServerKey(plugin: PluginInfo) {
  if (plugin.id) return `server:${plugin.id}`
  if (plugin.source.type === "package") return `server:package:${plugin.source.package}`
  if (plugin.source.type === "local") return `server:local:${plugin.source.path}`
  return `server:${plugin.source.type}`
}
