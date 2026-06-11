import { execFile, spawn } from "node:child_process"

export function execFileHidden(command: string, args: string[]) {
  return new Promise<{ stdout: string | Buffer; stderr: string | Buffer }>((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(error)
      resolve({ stdout, stderr })
    })
  })
}

export function spawnHidden(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true })
    child.once("error", reject)
    child.once("spawn", () => {
      Promise.resolve()
        .then(() => child.unref())
        .then(() => resolve(), reject)
    })
  })
}

export function openPathWithApp(path: string, app: string) {
  // Windows GUI apps should detach immediately; waiting for exit would keep Desktop tied to the launched app.
  if (process.platform === "win32") return spawnHidden(app, [path])
  const [cmd, args] = process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
  return execFileHidden(cmd, [...args]).then(() => undefined)
}
