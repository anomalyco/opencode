import type { WslOpencodeCheck, WslServersState } from "./contract"

/** A configured distro's settings row, from main's state alone. A server still starting can be updated or removed. */
export function wslRowView(state: WslServersState | undefined, distro: string) {
  const job = state?.distroJobs[distro]
  const check = state?.opencodeChecks[distro]
  const action = opencodeAction(check)
  const runtime = state?.servers.find((item) => item.config.distro === distro)?.runtime.kind
  const free = !job || job === "starting"

  return {
    version: check?.version ?? null,
    button: action ? { label: job === "updating" ? "server.updating" : action, disabled: !free } : null,
    retry: !job && (runtime === "failed" || runtime === "stopped"),
    removable: free,
  }
}

function opencodeAction(check: WslOpencodeCheck | undefined) {
  if (!check) return

  if (!check.resolvedPath) return "onboarding.installOpencode"

  if (check.matchesDesktop === false) return "onboarding.updateOpencode"
}
