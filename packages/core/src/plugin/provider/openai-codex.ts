export * as OpenAICodex from "./openai-codex"

// TEMPORARY SEAM (#34765): plugins have no hook into LLM route construction, so
// codex routing lives in SessionRunnerModel.fromCatalogModel and catalog filtering
// in OpenAIPlugin, sharing this module. Once the native provider packages land
// (#33689/#33925/#34462) this should collapse into the native OpenAI provider.
// The eligibility rules mirror V1's CodexAuthPlugin allowlist; models.dev has no
// plan-eligibility data for OpenAI today, but models other vendors' subscriptions
// as dedicated providers (e.g. zai-coding-plan) - a future openai-chatgpt-plan
// provider entry could replace the hardcoded rules with catalog data.

/** ChatGPT-plan requests must target the codex backend instead of the public API. */
export const baseURL = "https://chatgpt.com/backend-api/codex"

const methodIDs: readonly string[] = ["chatgpt-browser", "chatgpt-headless"]

/** Structural credential shape so both core and plugin-facing credential types fit. */
type CredentialLike = {
  readonly type: string
  readonly methodID?: string
  readonly metadata?: Record<string, unknown> | undefined
}

export const isChatGPT = (credential: CredentialLike | undefined) =>
  credential?.type === "oauth" && credential.methodID !== undefined && methodIDs.includes(credential.methodID)

export const accountID = (credential: CredentialLike | undefined) => {
  if (!isChatGPT(credential)) return undefined
  const value = credential?.metadata?.accountID
  return typeof value === "string" ? value : undefined
}

const allowed = new Set(["gpt-5.5", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini"])
const disallowed = new Set(["gpt-5.5-pro"])

/** Which API model ids a ChatGPT subscription may call through the codex backend. */
export const eligible = (apiID: string) => {
  if (allowed.has(apiID)) return true
  if (disallowed.has(apiID)) return false
  const match = apiID.match(/^gpt-(\d+\.\d+)/)
  return match ? Number.parseFloat(match[1]) > 5.4 : false
}
