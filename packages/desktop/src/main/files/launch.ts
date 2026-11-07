import { spawn } from "node:child_process"

// A successful launch is process creation, not the editor closing. Do not give the
// external app pipes or an event-loop reference back to the desktop process.
export function launchDetached(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true })

    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}
