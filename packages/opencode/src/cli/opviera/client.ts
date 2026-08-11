import { gatewayUrl } from "./config"

export interface WhoAmIProject {
  identifier: string
  name: string
}

export interface WhoAmIModel {
  id: string
  displayName: string
  provider: string
  supportsThinking: boolean
}

export interface WhoAmI {
  user: { id: string; name: string | null }
  organization: { id: string; name: string | null }
  key: { prefix: string; upstream: string }
  boundProjectId: string | null
  projectRequired: boolean
  projects: WhoAmIProject[]
  models: WhoAmIModel[]
  forcedModel: string | null
}

/**
 * A gateway rejection, already reduced to something worth showing a user.
 *
 * `retryable` distinguishes "your key is wrong, ask again" from "your key is fine but the account
 * is not usable" — the gate re-prompts on the former and exits on the latter, because re-typing a
 * suspended account's key a second time helps nobody.
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = "GatewayError"
  }
}

/**
 * Validate a key and fetch everything the CLI needs to start: the projects it may use, the models
 * its policy permits, and whether the key is already bound to a project.
 *
 * Free on the gateway — no quota, no usage event — and deliberately served above the billing gate,
 * so a valid key on a non-billing-active org still authenticates and we can say exactly that.
 */
export async function whoami(apiKey: string, signal?: AbortSignal): Promise<WhoAmI> {
  const url = `${gatewayUrl()}/v1/whoami`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
      signal,
    })
  } catch {
    throw new GatewayError(
      `Could not reach the Opviera gateway at ${url}. Check your connection, then try again.`,
      0,
      false,
    )
  }

  const requestId = response.headers.get("request-id") ?? undefined

  if (response.ok) {
    try {
      return (await response.json()) as WhoAmI
    } catch {
      throw new GatewayError("The gateway returned a malformed response.", response.status, false, requestId)
    }
  }

  const message = await errorMessage(response)

  // 401 means the key itself is wrong — worth asking for another one.
  if (response.status === 401) {
    throw new GatewayError(message, 401, true, requestId)
  }
  // 403 means the key authenticated but the account state blocks it: suspended user, paused key,
  // no policy, or inactive billing. Every one of those messages ends in "contact your
  // administrator", so re-prompting would only invite the user to hunt for a key that cannot exist.
  if (response.status === 403) {
    throw new GatewayError(message, 403, false, requestId)
  }
  if (response.status === 404) {
    throw new GatewayError(
      `The gateway at ${gatewayUrl()} does not support this CLI (no /v1/whoami). It may need upgrading.`,
      404,
      false,
      requestId,
    )
  }
  throw new GatewayError(message, response.status, false, requestId)
}

/** Gateway errors are Anthropic-shaped: `{ type: "error", error: { type, message } }`. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    const message = body?.error?.message
    if (typeof message === "string" && message.length > 0) return message
  } catch {
    // fall through to the generic message below
  }
  return `The gateway rejected the request (HTTP ${response.status}).`
}
