import { execSync } from "child_process"

export interface SandboxedCommandOptions {
  cwd: string
  command: string
  allowNetwork?: boolean
  readOnlyRoot?: boolean
}

export class ProcessSandboxManager {
  private static isBwrapAvailable(): boolean {
    if (process.platform !== "linux") return false
    try {
      execSync("which bwrap", { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  public static wrapCommand(opts: SandboxedCommandOptions): string {
    const isLinux = process.platform === "linux"
    const hasBwrap = this.isBwrapAvailable()

    if (isLinux && hasBwrap) {
      // Bubblewrap zero-trust container jail:
      // - Root filesystem is mounted strictly read-only (--ro-bind / /)
      // - Only the workspace directory is writable (--bind <cwd> <cwd>)
      // - Dedicated isolated /tmp and /dev
      const bwrapArgs = [
        "bwrap",
        "--ro-bind", "/", "/",
        "--bind", `"${opts.cwd}"`, `"${opts.cwd}"`,
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        "--unshare-pid",
        "--unshare-uts",
        "--unshare-ipc",
        "--die-with-parent",
      ]

      if (!opts.allowNetwork) {
        bwrapArgs.push("--unshare-net")
      }

      bwrapArgs.push("--chdir", `"${opts.cwd}"`)
      bwrapArgs.push("bash", "-c", `"${opts.command.replace(/"/g, '\\"')}"`)

      return bwrapArgs.join(" ")
    }

    // Default execution on platforms without bwrap
    return opts.command
  }
}
