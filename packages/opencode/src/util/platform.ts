import { execSync } from "child_process"
import fs from "fs"
import { lazy } from "./lazy"

export namespace Platform {
  export type Environment = "win32" | "wsl1" | "wsl2" | "linux" | "darwin"

  const detect = lazy((): Environment => {
    if (process.platform !== "linux") return process.platform === "win32" ? "win32" : "darwin"

    try {
      const version = fs.readFileSync("/proc/version", "utf8").toLowerCase()
      if (version.includes("microsoft") || version.includes("wsl")) {
        if (version.includes("microsoft-standard-wsl2")) return "wsl2"
        if (fs.existsSync("/sys/module/vsock")) return "wsl2"
        return "wsl1"
      }
    } catch {}

    return "linux"
  })

  export const env = (): Environment => detect()

  export const isWsl = (): boolean => {
    const e = env()
    return e === "wsl1" || e === "wsl2"
  }

  export const isWindows = (): boolean => process.platform === "win32" || isWsl()

  export const wslVersion = (): 1 | 2 | undefined => {
    const e = env()
    if (e === "wsl1") return 1
    if (e === "wsl2") return 2
    return undefined
  }

  export const wslDistro = (): string | undefined => process.env.WSL_DISTRO_NAME

  export function isWslUncPath(p: string): boolean {
    if (process.platform !== "win32") return false
    const lower = p.toLowerCase().replace(/\\/g, "/")
    return lower.startsWith("//wsl$/") || lower.startsWith("//wsl.localhost/")
  }

  export function parseWslUncPath(p: string): { distro: string; linuxPath: string } | undefined {
    if (!isWslUncPath(p)) return undefined
    const normalized = p.replace(/\\/g, "/")
    const match = normalized.match(/^\/\/wsl(?:\$|\.localhost)\/([^/]+)(\/.*)?$/i)
    if (!match) return undefined
    return { distro: match[1], linuxPath: match[2] || "/" }
  }

  export function toWslUncPath(linuxPath: string, distro: string): string {
    const posix = linuxPath.replace(/\\/g, "/")
    return `\\\\wsl$\\${distro}\\${posix.replace(/^\//, "")}`
  }

  export function wslDistros(): string[] {
    if (process.platform !== "win32") return []
    try {
      const result = execSync("wsl.exe --list --quiet", {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      })
      return result
        .split("\n")
        .map((line) => line.trim().replace(/\0/g, ""))
        .filter(Boolean)
    } catch {
      return []
    }
  }
}
