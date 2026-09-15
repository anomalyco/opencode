import { execFile } from "node:child_process"

export async function openPath(path: string, app: string | undefined, openDefault: (path: string) => Promise<string>) {
  if (!app) {
    // Electron resolves with an error string instead of rejecting when opening fails.
    const error = await openDefault(path)
    if (error) throw new Error(error)
    return
  }
  await new Promise<void>((resolve, reject) => {
    const [cmd, args] =
      process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
  })
}
