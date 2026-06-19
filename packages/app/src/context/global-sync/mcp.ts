import type { McpStatus } from "@opencode-ai/sdk/v2/client"

export async function toggleMcp(input: {
  status: McpStatus["status"]
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  authenticate: () => Promise<void>
  refresh: () => Promise<void>
}) {
  await {
    connected: input.disconnect,
    needs_auth: input.authenticate,
    disabled: input.connect,
    failed: input.connect,
    needs_client_registration: input.connect,
  }[input.status]()
  await input.refresh()
}
