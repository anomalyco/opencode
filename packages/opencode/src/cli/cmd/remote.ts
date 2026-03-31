import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"

type Input = {
  url: string
  directory?: string
  headers?: RequestInit["headers"]
  fetch?: typeof globalThis.fetch
}

export async function preflightRemote(input: Input): Promise<OpencodeClient> {
  const sdk = createOpencodeClient({
    baseUrl: input.url,
    directory: input.directory,
    headers: input.headers,
    fetch: input.fetch,
  })

  try {
    const result = await sdk.path.get(undefined, { throwOnError: true })
    const data = result.data
    if (!data) throw new Error("missing path data")
    if (input.directory && data.directory !== input.directory) {
      throw new Error(`Remote directory mismatch: expected ${input.directory} but server is using ${data.directory}`)
    }
    return sdk
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Remote directory mismatch:")) throw error
    const msg = error instanceof Error ? error.message : "request failed"
    throw new Error(`Failed to validate remote server at ${input.url}: ${msg}`)
  }
}
