import { Config } from "../config/config"
import { Log } from "../util/log"
import { Global } from "../global"
import path from "path"
import { Instance } from "../project/instance"

export namespace ToolFavorites {
  const log = Log.create({ service: "tool-favorites" })

  export type FavoriteLevel = "none" | "project" | "global"

  // In-memory cache
  let cachedProjectFavorites: Set<string> | null = null
  let cachedGlobalFavorites: Set<string> | null = null

  export async function loadProject(): Promise<Set<string>> {
    if (cachedProjectFavorites) return cachedProjectFavorites

    try {
      const config = await Config.get()
      cachedProjectFavorites = new Set(config.favoriteTools || [])
      log.info("loaded project favorite tools", { count: cachedProjectFavorites.size })
      return cachedProjectFavorites
    } catch (error) {
      cachedProjectFavorites = new Set()
      return cachedProjectFavorites
    }
  }

  export async function loadGlobal(): Promise<Set<string>> {
    if (cachedGlobalFavorites) return cachedGlobalFavorites

    try {
      const globalConfig = await Config.global()
      cachedGlobalFavorites = new Set(globalConfig.favoriteTools || [])
      log.info("loaded global favorite tools", { count: cachedGlobalFavorites.size })
      return cachedGlobalFavorites
    } catch (error) {
      cachedGlobalFavorites = new Set()
      return cachedGlobalFavorites
    }
  }

  export async function getLevel(toolId: string): Promise<FavoriteLevel> {
    const globalFavs = await loadGlobal()
    if (globalFavs.has(toolId)) return "global"

    const projectFavs = await loadProject()
    if (projectFavs.has(toolId)) return "project"

    return "none"
  }

  export async function saveProject(favorites: Set<string>): Promise<void> {
    try {
      const configPath = await findConfigFile()

      const file = Bun.file(configPath)
      const content = await file.text()

      let config: any
      try {
        config = JSON.parse(content)
      } catch {
        const { parse } = await import("jsonc-parser")
        config = parse(content) || {}
      }

      config.favoriteTools = Array.from(favorites)
      await Bun.write(configPath, JSON.stringify(config, null, 2))
      cachedProjectFavorites = favorites
      log.info("saved project favorite tools", { count: favorites.size, path: configPath })
    } catch (error) {
      log.error("failed to save project favorites", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export async function saveGlobal(favorites: Set<string>): Promise<void> {
    try {
      const globalConfigPath = path.join(Global.Path.config, "codesurf.jsonc")

      let config: any = {}
      const file = Bun.file(globalConfigPath)
      if (await file.exists()) {
        const content = await file.text()
        try {
          config = JSON.parse(content)
        } catch {
          const { parse } = await import("jsonc-parser")
          config = parse(content) || {}
        }
      }

      config.favoriteTools = Array.from(favorites)
      await Bun.write(globalConfigPath, JSON.stringify(config, null, 2))
      cachedGlobalFavorites = favorites
      log.info("saved global favorite tools", { count: favorites.size, path: globalConfigPath })
    } catch (error) {
      log.error("failed to save global favorites", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function findConfigFile(): Promise<string> {
    const configPath = await Config.projectConfigPath()
    const file = Bun.file(configPath)
    if (!(await file.exists())) {
      await Bun.write(configPath, JSON.stringify({}, null, 2))
      log.info("created new config file", { path: configPath })
    }
    return configPath
  }

  // Cycle through states: none → project → global → none
  export async function cycle(toolId: string): Promise<FavoriteLevel> {
    const currentLevel = await getLevel(toolId)

    const projectFavs = await loadProject()
    const globalFavs = await loadGlobal()

    if (currentLevel === "none") {
      // Add to project favorites
      projectFavs.add(toolId)
      await saveProject(projectFavs)
      return "project"
    } else if (currentLevel === "project") {
      // Move to global favorites
      projectFavs.delete(toolId)
      await saveProject(projectFavs)
      globalFavs.add(toolId)
      await saveGlobal(globalFavs)
      return "global"
    } else {
      // Remove from global favorites (back to none)
      globalFavs.delete(toolId)
      await saveGlobal(globalFavs)
      return "none"
    }
  }

  export async function list(): Promise<{ project: string[]; global: string[] }> {
    const projectFavs = await loadProject()
    const globalFavs = await loadGlobal()
    return {
      project: Array.from(projectFavs),
      global: Array.from(globalFavs),
    }
  }

  export function clear() {
    cachedProjectFavorites = null
    cachedGlobalFavorites = null
  }

  // Sort tools with global favorites first, then project favorites, then the rest
  export async function sortTools<T extends { id?: string; name?: string }>(
    tools: T[],
  ): Promise<T[]> {
    const projectFavs = await loadProject()
    const globalFavs = await loadGlobal()

    return tools.sort((a, b) => {
      const aId = a.id || (a as any).name || ""
      const bId = b.id || (b as any).name || ""

      const aGlobal = globalFavs.has(aId)
      const bGlobal = globalFavs.has(bId)
      const aProject = projectFavs.has(aId)
      const bProject = projectFavs.has(bId)

      // Global favorites first
      if (aGlobal && !bGlobal) return -1
      if (!aGlobal && bGlobal) return 1

      // Then project favorites
      if (aProject && !bProject) return -1
      if (!aProject && bProject) return 1

      // Keep original order for same level
      return 0
    })
  }
}
