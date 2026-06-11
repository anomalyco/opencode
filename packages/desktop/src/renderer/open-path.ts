import type { ElectronAPI } from "../preload/types"
import { createAppPathCache, forgetAppPath, getAppPath, rememberAppPath } from "../app-path-cache"

type OpenPathAPI = Pick<ElectronAPI, "openPath" | "resolveAppPath">

export function createOpenPath(api: OpenPathAPI, os: "macos" | "windows" | "linux" | undefined) {
  const appPathCache = createAppPathCache()

  const resolve = async (app: string) => {
    const key = app.toLowerCase()
    const resolved = await api.resolveAppPath(app).catch(() => null)
    if (!resolved) {
      forgetAppPath(appPathCache, key)
      return undefined
    }
    return rememberAppPath(appPathCache, key, resolved)
  }

  return async (path: string, app?: string) => {
    if (os !== "windows") return api.openPath(path, app)
    if (!app) return api.openPath(path)

    const key = app.toLowerCase()
    const cached = getAppPath(appPathCache, key)
    if (!cached) return api.openPath(path, await resolve(app))

    return api.openPath(path, cached).catch(async () => {
      // Resolved app paths can go stale after updates or uninstalls; retry through the resolver once.
      forgetAppPath(appPathCache, key)
      return api.openPath(path, await resolve(app))
    })
  }
}
