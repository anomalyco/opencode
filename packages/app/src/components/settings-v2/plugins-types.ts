// Shared type contracts between desktop main-process IPC and the app renderer.
// Keep this file dependency-free so both packages can import it.

export type PluginEntry = string | [name: string, options: Record<string, unknown>]

export type CatalogEntry = {
  name: string
  description?: string
  version?: string
  downloadsLastWeek?: number
  updatedAt?: string
  repository?: string
  onNpm: boolean
  source: "ecosystem" | "awesome"
}

export type CatalogResult = { entries: CatalogEntry[]; fetchedAt: number; stale: boolean }

export type RecentlyRemoved = {
  name: string
  entry: PluginEntry
  scope: "global" | "project"
  removedAt: number
}

export type PluginConfigsPayload = {
  global: PluginEntry[]
  project: PluginEntry[]
  recentlyRemoved: RecentlyRemoved[]
  paths: { global: string; project: string | null }
}

export type PluginManagerPlatform = {
  fetchCatalog(): Promise<CatalogResult>
  readConfigs(projectDir?: string): Promise<PluginConfigsPayload>
  install(
    name: string,
    entry?: PluginEntry,
    scope?: "global" | "project",
    projectDir?: string,
  ): Promise<{ ok: true }>
  remove(name: string, scope: "global" | "project", remember: boolean, projectDir?: string): Promise<{ ok: true }>
}