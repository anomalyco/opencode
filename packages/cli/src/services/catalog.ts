import type { OpenCodeClient } from "@opencode-ai/client/promise"

// Location plugins initialize asynchronously, so explicit model selection must
// wait for that exact model before prompt admission. The execution path owns
// the authoritative error if readiness times out.
export async function waitForCatalogReady(input: {
  sdk: OpenCodeClient
  directory: string
  workspace?: string
  model: { providerID: string; modelID: string }
  timeoutMs?: number
}) {
  const deadline = Date.now() + (input.timeoutMs ?? 5_000)
  while (Date.now() < deadline) {
    const models = await input.sdk.model
      .list({ location: { directory: input.directory, workspace: input.workspace } })
      .then((result) => result.data)
      .catch(() => undefined)
    if (models?.some((model) => model.providerID === input.model.providerID && model.id === input.model.modelID)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
