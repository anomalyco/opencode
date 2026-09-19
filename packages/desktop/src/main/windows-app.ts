import { execFile, spawn } from "node:child_process"

type Launcher = {
  execFile: typeof execFile
  spawn: typeof spawn
}

const system: Launcher = { execFile, spawn }

export function openWindowsApp(appPath: string, targetPath: string, launcher: Launcher = system): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    launcher.execFile(appPath, [targetPath], (err) => {
      if (!err) return resolve()
      if ((err as NodeJS.ErrnoException).code !== "EACCES") return reject(err)
      const child = launcher.spawn("cmd.exe", ["/d", "/c", "start", "", appPath, targetPath], {
        stdio: "ignore",
      })
      child.once("error", reject)
      child.once("spawn", () => {
        child.unref()
        resolve()
      })
    })
  })
}