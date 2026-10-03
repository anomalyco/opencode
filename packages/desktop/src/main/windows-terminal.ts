import { spawn } from "node:child_process"
import { basename } from "node:path"

const POWERSHELL_EXECUTABLES = new Set(["powershell", "powershell.exe", "pwsh", "pwsh.exe"])

export function isPowerShellApp(appPath: string): boolean {
  return POWERSHELL_EXECUTABLES.has(basename(appPath).toLowerCase())
}

export function buildPowerShellLocationCommand(targetPath: string): string {
  return `Set-Location -LiteralPath '${targetPath.replace(/'/g, "''")}'`
}

export function encodePowerShellCommand(command: string): string {
  return Buffer.from(command, "utf16le").toString("base64")
}

export function openPowerShellWindow(appPath: string, targetPath: string): Promise<void> {
  const encoded = encodePowerShellCommand(buildPowerShellLocationCommand(targetPath))
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "cmd.exe",
      ["/d", "/c", "start", "", appPath, "-NoExit", "-EncodedCommand", encoded],
      { stdio: "ignore" },
    )
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}
