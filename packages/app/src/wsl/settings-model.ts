import type { WslOpencodeCheck, WslServerRuntime } from "./types"

export const wslRuntimeRetryable = (runtime: WslServerRuntime) =>
  runtime.kind === "failed" || runtime.kind === "stopped"

export function wslOpencodeAction(check?: WslOpencodeCheck) {
  if (!check) return
  if (!check.resolvedPath) return "Install OpenCode"
  if (check.matchesDesktop === false) return "Update OpenCode"
}
