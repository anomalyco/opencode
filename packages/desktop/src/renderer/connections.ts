import type { SshServersState } from "@opencode-ai/app/ssh/types"
import type { WslServersState } from "@opencode-ai/app/wsl/types"

/**
 * Desktop-managed servers (WSL/SSH) start asynchronously; if the persisted
 * default points at one that is not ready yet, fall back to the local sidecar
 * so startup never blocks.
 */
export function availableStartupServer(
  defaultServer: string | null | undefined,
  wsl?: WslServersState,
  ssh?: SshServersState,
) {
  const key = defaultServer ?? "sidecar"
  if (key.startsWith("wsl:")) return serverReady(wsl?.servers, key) ? key : "sidecar"
  if (key.startsWith("ssh:")) return serverReady(ssh?.servers, key) ? key : "sidecar"
  return key
}

function serverReady(servers: Array<{ config: { id: string }; runtime: { kind: string } }> | undefined, key: string) {
  return !!servers?.some((item) => item.config.id === key && item.runtime.kind === "ready")
}
