import { access, readFile, readdir } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { createAppPathCache, forgetAppPath, getAppPath, rememberAppPath } from "../app-path-cache"
import { execFileHidden } from "./child-process"

const exists = (path: string) =>
  access(path)
    .then(() => true)
    .catch(() => false)

const windowsAppPathCache = createAppPathCache()

const searchKey = (value: string) =>
  value
    .split("")
    .filter((value: string) => /[a-z0-9]/i.test(value))
    .map((value: string) => value.toLowerCase())
    .join("")

export function checkAppExists(appName: string) {
  if (process.platform === "win32") return true
  if (process.platform === "linux") return true
  return checkMacosApp(appName)
}

export function resolveAppPath(appName: string) {
  if (process.platform !== "win32") return appName
  return resolveWindowsAppPath(appName)
}

async function checkMacosApp(appName: string) {
  const locations = [`/Applications/${appName}.app`, `/System/Applications/${appName}.app`]

  const home = process.env.HOME
  if (home) locations.push(`${home}/Applications/${appName}.app`)

  for (const location of locations) {
    if (await exists(location)) return true
  }

  return execFileHidden("which", [appName])
    .then(() => true)
    .catch(() => false)
}

async function resolveWindowsAppPath(appName: string): Promise<string | null> {
  const cacheKey = appName.toLowerCase()
  const cached = getAppPath(windowsAppPathCache, cacheKey)
  if (cached) {
    if (await exists(cached)) return cached
    forgetAppPath(windowsAppPathCache, cacheKey)
  }

  // Cache only positive resolutions; missing apps may be installed while Desktop stays open.
  const remember = (path: string) => {
    return rememberAppPath(windowsAppPathCache, cacheKey, path)
  }

  let output: string
  try {
    output = await execFileHidden("where", [appName]).then((r) => r.stdout.toString())
  } catch {
    return null
  }

  const paths = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const hasExt = (path: string, ext: string) => extname(path).toLowerCase() === `.${ext}`

  const executables = paths.filter((path) => hasExt(path, "exe") || hasExt(path, "com"))
  if (executables[0] && (await exists(executables[0]))) return remember(executables[0])

  const executable = (
    await Promise.all(executables.slice(1).map(async (path) => ((await exists(path)) ? path : null)))
  ).find((path) => path !== null)
  if (executable) return remember(executable)

  const resolveCmd = async (path: string) => {
    const content = await readFile(path, "utf8").catch(() => "")
    if (!content) return null

    // Windows package managers often expose .cmd shims; launch the target executable instead of the shim.
    for (const token of content.split('"').map((value: string) => value.trim())) {
      const lower = token.toLowerCase()
      if (!lower.includes(".exe")) continue

      const index = lower.indexOf("%~dp0")
      if (index >= 0) {
        const base = dirname(path)
        const suffix = token.slice(index + 5)
        const resolved = suffix
          .replace(/\//g, "\\")
          .split("\\")
          .filter((part: string) => part && part !== ".")
          .reduce((current: string, part: string) => {
            if (part === "..") return dirname(current)
            return join(current, part)
          }, base)

        if (await exists(resolved)) return resolved
      }

      if (await exists(token)) return token
    }

    return null
  }

  for (const path of paths) {
    if (hasExt(path, "cmd") || hasExt(path, "bat")) {
      const resolved = await resolveCmd(path)
      if (resolved) return remember(resolved)
    }

    if (!extname(path)) {
      const cmd = `${path}.cmd`
      if (await exists(cmd)) {
        const resolved = await resolveCmd(cmd)
        if (resolved) return remember(resolved)
      }

      const bat = `${path}.bat`
      if (await exists(bat)) {
        const resolved = await resolveCmd(bat)
        if (resolved) return remember(resolved)
      }
    }
  }

  const key = searchKey(appName)

  if (key) {
    for (const path of paths) {
      const dirs = [dirname(path), dirname(dirname(path)), dirname(dirname(dirname(path)))]
      for (const dir of dirs) {
        try {
          for (const entry of await readdir(dir)) {
            const candidate = join(dir, entry)
            if (!hasExt(candidate, "exe")) continue
            const stem = entry.replace(/\.exe$/i, "")
            const name = searchKey(stem)
            if (name.includes(key) || key.includes(name)) return remember(candidate)
          }
        } catch {
          continue
        }
      }
    }
  }

  return null
}
