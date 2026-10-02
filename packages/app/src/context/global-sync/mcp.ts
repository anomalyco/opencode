import type { McpServer } from "@opencode-ai/client/promise"

export async function toggleMcp(input: {
  status: McpServer["status"]["status"]
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  authenticate: () => Promise<void>
  refresh: () => Promise<void>
}) {
  if (input.status === "pending") return
  await {
    connected: input.disconnect,
    needs_auth: input.authenticate,
    disabled: input.connect,
    failed: input.connect,
    needs_client_registration: input.connect,
  }[input.status]()
  await input.refresh()
}
