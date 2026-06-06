import type { WslServersState } from "@opencode-ai/app/wsl/types"

export function readyWslConnections(state?: WslServersState) {
  return (state?.servers ?? []).flatMap((item) => {
    if (item.runtime.kind !== "ready") return []
    return [
      {
        displayName: item.config.distro,
        label: "WSL",
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

export function availableStartupServer(defaultServer: string | null | undefined, state?: WslServersState) {
  const key = defaultServer ?? "sidecar"
  if (!key.startsWith("wsl:")) return key
  if (state?.servers.some((item) => item.config.id === key && item.runtime.kind === "ready")) return key
  return "sidecar"
}
