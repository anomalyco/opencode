import { ClientError, type OpenCodeClient } from "@opencode-ai/client/promise"

// Location plugins initialize asynchronously, so explicit model selection must
// wait for that exact model before prompt admission. The execution path owns
// the authoritative error if readiness times out.
export async function waitForCatalogReady(input: {
  sdk: OpenCodeClient
  directory: string
  workspace?: string
  model: { providerID: string; modelID: string }
  timeoutMs?: number
  signal?: AbortSignal
}) {
  const deadline = Date.now() + (input.timeoutMs ?? 5_000)
  while (Date.now() < deadline && !input.signal?.aborted) {
    const models = await input.sdk.model
      .list(
        { location: { directory: input.directory, workspace: input.workspace } },
        { signal: input.signal },
      )
      .then((result) => result.data)
      .catch((error) => {
        if (input.signal && error instanceof ClientError && error.reason === "Transport") throw error
        return undefined
      })
    if (models?.some((model) => model.providerID === input.model.providerID && model.id === input.model.modelID)) return
    await wait(25, input.signal)
  }
}

function wait(delay: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, delay))
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", done)
      resolve()
    }
  })
}
