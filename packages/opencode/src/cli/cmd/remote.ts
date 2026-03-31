import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"

type Input = {
  url: string
  directory?: string
  headers?: RequestInit["headers"]
  fetch?: typeof globalThis.fetch
}

type TargetInput = {
  sdk: OpencodeClient
  directory?: string
  continue?: boolean
  sessionID?: string
  fork?: boolean
}

type Target = {
  baseID?: string
  title?: string
}

function suffix(dir?: string) {
  return dir ? ` for ${dir}` : ""
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "request failed"
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

export async function resolveRemoteTarget(input: TargetInput): Promise<Target> {
  if (!input.continue && !input.sessionID) return {}

  if (input.sessionID) {
    await input.sdk.session.get({ sessionID: input.sessionID }, { throwOnError: true }).catch(() => {
      const kind = input.fork ? "Remote fork base session" : "Remote session"
      throw new Error(`${kind} "${input.sessionID}" not found${suffix(input.directory)}`)
    })
    return { baseID: input.sessionID }
  }

  const result = await input.sdk.session.list({ roots: true }, { throwOnError: true }).catch((error) => {
    throw new Error(`Failed to resolve remote continue target${suffix(input.directory)}: ${message(error)}`)
  })
  const item = result.data?.find((item) => !item.parentID)
  const baseID = item?.id
  if (!baseID) throw new Error(`No remote session found to continue${suffix(input.directory)}`)
  return { baseID, title: item?.title }
}
