import type { SshServersState } from "@opencode-ai/app/ssh/types"

export function readySshConnections(state?: SshServersState, label = "SSH") {
  return (state?.servers ?? []).flatMap((item) => {
    if (item.runtime.kind !== "ready") return []
    return [
      {
        displayName: item.config.host,
        label,
        type: "ssh" as const,
        host: item.config.host,
        http: {
          url: item.runtime.url,
          username: item.runtime.username ?? undefined,
          password: item.runtime.password ?? undefined,
        },
      },
    ]
  })
}
