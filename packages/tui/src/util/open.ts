import { spawn, type ChildProcess } from "child_process"

/**
 * Open a URL in the default browser using native platform commands.
 *
 * - macOS: `open <url>`
 * - Windows: `start "" <url>` (via cmd.exe — avoids PowerShell/.NET startup overhead)
 * - Linux: `xdg-open <url>`
 *
 * Returns a detached ChildProcess so callers can listen for "error"/"exit"
 * to detect headless environments where no browser is available.
 */
export function open(url: string): ChildProcess {
  const args: string[] = []
  let cmd: string

  if (process.platform === "darwin") {
    cmd = "open"
    args.push(url)
  } else if (process.platform === "win32") {
    cmd = "cmd"
    args.push("/c", "start", '""', url)
  } else {
    cmd = "xdg-open"
    args.push(url)
  }

  const child = spawn(cmd, args, {
    stdio: "ignore",
    detached: true,
  })
  child.unref()
  return child
}
