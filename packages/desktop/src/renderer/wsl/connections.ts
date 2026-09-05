import type { WslServersState } from "@opencode-ai/app/wsl/types"

export function readyWslConnections(state?: WslServersState, label = "WSL") {
  return (state?.servers ?? []).flatMap((item) => {
    if (item.runtime.kind !== "ready") return []
    return [
      {
        displayName: item.config.distro,
        label,
        type: "sidecar" as const,
        variant: "wsl" as const,
        distro: item.config.distro,
        http: {
          url: item.runtime.url,
          username: item.runtime.username ?? undefined,
          password: item.runtime.password ?? undefined,
        },
      },
    ]
  })
}
