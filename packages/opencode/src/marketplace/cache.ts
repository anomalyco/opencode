import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Log } from "../util/log"
import { MarketplaceSchema } from "./schema"
import { MarketplaceGitHub } from "./github"
import { MarketplaceDiscovery } from "./discovery"

export namespace MarketplaceCache {
  const log = Log.create({ service: "marketplace.cache" })

  // Cache directory
  const CACHE_DIR = path.join(Global.Path.cache, "marketplace")

  // Ensure cache directory exists
  async function ensureCacheDir(): Promise<void> {
    await fs.mkdir(CACHE_DIR, { recursive: true })
  }

  // Get cache file path for a source
  function getCacheFilePath(source: MarketplaceSchema.Source): string {
    // Create a safe filename from the repo
    const safeRepo = source.repo.replace(/[/\\:*?"<>|]/g, "_")
    const ref = source.ref || "default"
    return path.join(CACHE_DIR, `${safeRepo}_${ref}.json`)
  }

  // Get content cache directory for a source
  function getContentCacheDir(source: MarketplaceSchema.Source): string {
    const safeRepo = source.repo.replace(/[/\\:*?"<>|]/g, "_")
    return path.join(CACHE_DIR, "content", safeRepo)
  }

  // Get cached registry for a source
  export async function getCachedRegistry(
    source: MarketplaceSchema.Source,
    cacheDuration: number = 3600000,
  ): Promise<MarketplaceSchema.CachedSource | null> {
    const cacheFile = getCacheFilePath(source)
    try {
      const data = await Bun.file(cacheFile).json()
      const parsed = MarketplaceSchema.CachedSource.parse(data)

      // Check if cache is still valid
      if (Date.now() - parsed.lastFetched < cacheDuration) {
        log.debug("cache hit", { repo: source.repo })
        return parsed
      }

      log.debug("cache expired", { repo: source.repo })
    } catch {
      log.debug("cache miss", { repo: source.repo })
    }
    return null
  }

  // Save cached source data
  async function saveCachedSource(
    source: MarketplaceSchema.Source,
    cached: MarketplaceSchema.CachedSource,
  ): Promise<void> {
    await ensureCacheDir()
    const cacheFile = getCacheFilePath(source)
    await Bun.write(cacheFile, JSON.stringify(cached, null, 2))
    log.debug("cache saved", { repo: source.repo })
  }

  // Try to fetch registry.json from GitHub
  async function fetchRegistryJson(
    source: MarketplaceSchema.Source,
    cached: MarketplaceSchema.CachedSource | null,
  ): Promise<{ registry: MarketplaceSchema.RegistryIndex; etag?: string } | null> {
    const registryPath = source.path ? `${source.path}/registry.json` : "registry.json"

    try {
      if (cached?.etag) {
        // Try conditional request
        const result = await MarketplaceGitHub.getContentIfModified(
          source.repo,
          registryPath,
          source.ref,
          cached.etag,
        )

        if (!result.modified) {
          // Not modified, return cached registry
          return { registry: cached.registry, etag: cached.etag }
        }

        // Modified, parse new registry
        const registry = MarketplaceSchema.RegistryIndex.parse(JSON.parse(result.content))
        return { registry, etag: result.etag }
      } else {
        // No cached data, fetch fresh
        const { content, etag } = await MarketplaceGitHub.getRawContent(
          source.repo,
          registryPath,
          source.ref,
        )

        const registry = MarketplaceSchema.RegistryIndex.parse(JSON.parse(content))
        return { registry, etag }
      }
    } catch (error) {
      // registry.json not found or invalid
      log.debug("registry.json not found or invalid", { repo: source.repo, error })
      return null
    }
  }

  // Refresh registry from GitHub (with discovery fallback)
  export async function refreshRegistry(
    source: MarketplaceSchema.Source,
  ): Promise<MarketplaceSchema.CachedSource> {
    log.info("refreshing registry", { repo: source.repo })

    // Get cached data for conditional request
    const cached = await getCachedRegistry(source, Infinity) // Get cached regardless of age

    // First, try to fetch registry.json
    const registryResult = await fetchRegistryJson(source, cached)

    if (registryResult) {
      // registry.json found
      log.debug("using registry.json", { repo: source.repo })
      const newCached: MarketplaceSchema.CachedSource = {
        source,
        registry: registryResult.registry,
        lastFetched: Date.now(),
        etag: registryResult.etag,
      }
      await saveCachedSource(source, newCached)
      return newCached
    }

    // Fallback: use discovery to scan for agents (Claude Code compatibility)
    log.info("registry.json not found, using auto-discovery", { repo: source.repo })

    try {
      const registry = await MarketplaceDiscovery.buildRegistry(source)

      const newCached: MarketplaceSchema.CachedSource = {
        source,
        registry,
        lastFetched: Date.now(),
        // No etag for discovered registries
      }
      await saveCachedSource(source, newCached)
      return newCached
    } catch (error) {
      // Discovery failed
      log.error("discovery failed", { repo: source.repo, error })

      // If we have cached data, return it
      if (cached) {
        log.warn("using cached data after discovery failure", { repo: source.repo })
        return cached
      }

      throw error
    }
  }

  // Get or refresh registry (main entry point)
  export async function getRegistry(
    source: MarketplaceSchema.Source,
    options: { refresh?: boolean; cacheDuration?: number } = {},
  ): Promise<MarketplaceSchema.CachedSource> {
    const { refresh = false, cacheDuration = 3600000 } = options

    if (refresh) {
      return refreshRegistry(source)
    }

    const cached = await getCachedRegistry(source, cacheDuration)
    if (cached) {
      return cached
    }

    return refreshRegistry(source)
  }

  // Cache agent content locally
  export async function cacheAgentContent(
    source: MarketplaceSchema.Source,
    agentPath: string,
    content: string,
  ): Promise<string> {
    const contentDir = getContentCacheDir(source)
    await fs.mkdir(contentDir, { recursive: true })

    const localPath = path.join(contentDir, agentPath)
    await fs.mkdir(path.dirname(localPath), { recursive: true })
    await Bun.write(localPath, content)

    return localPath
  }

  // Get cached agent content
  export async function getCachedAgentContent(
    source: MarketplaceSchema.Source,
    agentPath: string,
  ): Promise<string | null> {
    const contentDir = getContentCacheDir(source)
    const localPath = path.join(contentDir, agentPath)

    try {
      return await Bun.file(localPath).text()
    } catch {
      return null
    }
  }

  // Clear all cache
  export async function clearAll(): Promise<void> {
    try {
      await fs.rm(CACHE_DIR, { recursive: true, force: true })
      log.info("cache cleared")
    } catch {
      // Cache dir might not exist
    }
  }

  // Clear cache for a specific source
  export async function clearSource(source: MarketplaceSchema.Source): Promise<void> {
    const cacheFile = getCacheFilePath(source)
    const contentDir = getContentCacheDir(source)

    try {
      await fs.rm(cacheFile, { force: true })
      await fs.rm(contentDir, { recursive: true, force: true })
      log.info("source cache cleared", { repo: source.repo })
    } catch {
      // Files might not exist
    }
  }
}
