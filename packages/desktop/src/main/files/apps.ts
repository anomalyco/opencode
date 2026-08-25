import { execFile } from "node:child_process"
import util from "node:util"
import { Effect, FileSystem, Path } from "effect"

const execFilePromise = util.promisify(execFile)

export const checkAppExists = Effect.fn("DesktopFiles.checkAppExists")(function* (appName: string) {
  if (process.platform === "win32") return true
  if (process.platform === "linux") return true
  return yield* checkMacosApp(appName)
})

export const resolveAppPath = Effect.fn("DesktopFiles.resolveAppPath")(function* (appName: string) {
  if (process.platform !== "win32") return appName
  return yield* resolveWindowsAppPath(appName)
})

const checkMacosApp = Effect.fn("DesktopFiles.checkMacosApp")(function* (appName: string) {
  const fs = yield* FileSystem.FileSystem
  const locations = [`/Applications/${appName}.app`, `/System/Applications/${appName}.app`]

  const home = process.env.HOME
  if (home) locations.push(`${home}/Applications/${appName}.app`)

  for (const location of locations) {
    if (yield* exists(fs, location)) return true
  }

  return yield* Effect.tryPromise(() => execFilePromise("which", [appName])).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )
})

const resolveWindowsAppPath = Effect.fn("DesktopFiles.resolveWindowsAppPath")(function* (appName: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const result = yield* Effect.tryPromise(() => execFilePromise("where", [appName])).pipe(
    Effect.orElseSucceed(() => undefined),
  )
  if (!result) return null

  const paths = result.stdout
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const hasExt = (value: string, ext: string) => path.extname(value).toLowerCase() === `.${ext}`

  const exe = paths.find((path) => hasExt(path, "exe"))
  if (exe) return exe

  const resolveCmd = Effect.fnUntraced(function* (file: string) {
    const content = yield* fs.readFileString(file)
    for (const token of content.split('"').map((value: string) => value.trim())) {
      const lower = token.toLowerCase()
      if (!lower.includes(".exe")) continue

      const index = lower.indexOf("%~dp0")
      if (index >= 0) {
        const base = path.dirname(file)
        const suffix = token.slice(index + 5)
        const resolved = suffix
          .replace(/\//g, "\\")
          .split("\\")
          .filter((part: string) => part && part !== ".")
          .reduce((current: string, part: string) => {
            if (part === "..") return path.dirname(current)
            return path.join(current, part)
          }, base)

        if (yield* exists(fs, resolved)) return resolved
      }

      if (yield* exists(fs, token)) return token
    }

    return null
  })

  for (const file of paths) {
    if (hasExt(file, "cmd") || hasExt(file, "bat")) {
      const resolved = yield* resolveCmd(file)
      if (resolved) return resolved
    }

    if (!path.extname(file)) {
      const cmd = `${file}.cmd`
      if (yield* exists(fs, cmd)) {
        const resolved = yield* resolveCmd(cmd)
        if (resolved) return resolved
      }

      const bat = `${file}.bat`
      if (yield* exists(fs, bat)) {
        const resolved = yield* resolveCmd(bat)
        if (resolved) return resolved
      }
    }
  }

  const key = appName
    .split("")
    .filter((value: string) => /[a-z0-9]/i.test(value))
    .map((value: string) => value.toLowerCase())
    .join("")

  if (key) {
    for (const file of paths) {
      const dirs = [path.dirname(file), path.dirname(path.dirname(file)), path.dirname(path.dirname(path.dirname(file)))]
      for (const dir of dirs) {
        const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []))
        for (const entry of entries) {
          const candidate = path.join(dir, entry)
          if (!hasExt(candidate, "exe")) continue
          const stem = entry.replace(/\.exe$/i, "")
          const name = stem
            .split("")
            .filter((value: string) => /[a-z0-9]/i.test(value))
            .map((value: string) => value.toLowerCase())
            .join("")
          if (name.includes(key) || key.includes(name)) return candidate
        }
      }
    }
  }

  return paths[0] ?? null
})

function exists(fs: FileSystem.FileSystem, path: string) {
  return fs.exists(path).pipe(Effect.orElseSucceed(() => false))
}
