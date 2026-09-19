import { execFile, spawn } from "node:child_process"

type Launcher = {
  execFile: typeof execFile
  spawn: typeof spawn
}

const system: Launcher = { execFile, spawn }

const isSpawnFailure = (err: unknown): err is NodeJS.ErrnoException => {
  if (typeof err !== "object" || err === null) return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== "string") return false
  const syscall = (err as { syscall?: unknown }).syscall
  return syscall === undefined || (typeof syscall === "string" && syscall.startsWith("spawn"))
}

export const encodeLaunchCommand = (appPath: string, targetPath: string): string => {
  const quoted = (value: string) => `'${value.replace(/'/g, "''")}'`
  return Buffer.from(`Start-Process -FilePath ${quoted(appPath)} -ArgumentList ${quoted(targetPath)}`, "utf16le").toString(
    "base64",
  )
}

export function openWindowsApp(appPath: string, targetPath: string, launcher: Launcher = system): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    launcher.execFile(appPath, [targetPath], (err) => {
      if (!err) return resolve()
      if (!isSpawnFailure(err)) return reject(err)
      const child = launcher.spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encodeLaunchCommand(appPath, targetPath)],
        { stdio: "ignore", windowsHide: true },
      )
      child.once("error", reject)
      child.once("close", (code) => {
        if (code !== 0) return reject(new Error(`shell fallback for ${appPath} exited with code ${code}`))
        resolve()
      })
    })
  })
}