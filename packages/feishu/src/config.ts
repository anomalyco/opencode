export type ModelRef = {
  providerID: string
  modelID: string
}

export type GatewayConfig = {
  appID: string
  appSecret: string
  model: ModelRef
  dataDirectory: string
  workspaceDirectory: string
  maxConcurrency: number
  replyAttempts: number
  replyTimeoutMs: number
}

export function parseGatewayConfig(env: Record<string, string | undefined>): GatewayConfig {
  const required = [
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_MODEL",
    "FEISHU_DATA_DIRECTORY",
    "FEISHU_WORKSPACE_DIRECTORY",
  ].filter((name) => !env[name]?.trim())
  if (required.length) throw new Error(`Missing gateway configuration: ${required.join(", ")}`)

  const model = parseModelRef(env.FEISHU_MODEL!)
  assertDeepSeekModel(model)

  return {
    appID: env.FEISHU_APP_ID!.trim(),
    appSecret: env.FEISHU_APP_SECRET!.trim(),
    model,
    dataDirectory: env.FEISHU_DATA_DIRECTORY!.trim(),
    workspaceDirectory: env.FEISHU_WORKSPACE_DIRECTORY!.trim(),
    maxConcurrency: parsePositiveInteger(env.FEISHU_MAX_CONCURRENCY, "FEISHU_MAX_CONCURRENCY", 4),
    replyAttempts: parsePositiveInteger(env.FEISHU_REPLY_ATTEMPTS, "FEISHU_REPLY_ATTEMPTS", 3),
    replyTimeoutMs: parsePositiveInteger(env.FEISHU_REPLY_TIMEOUT_MS, "FEISHU_REPLY_TIMEOUT_MS", 15_000),
  }
}

export function assertDeepSeekModel(model: ModelRef) {
  if (model.modelID.toLowerCase().includes("deepseek")) return
  throw new Error("FEISHU_MODEL must select a DeepSeek model")
}

export function preflightDeepSeek(
  model: ModelRef,
  resolve: (model: ModelRef) => Promise<{ providerID: string; modelID: string; authenticated: boolean }>,
) {
  assertDeepSeekModel(model)
  return resolve(model).then(
    (resolved) => {
      if (resolved.providerID !== model.providerID || resolved.modelID !== model.modelID)
        throw new Error("DeepSeek model resolution mismatch")
      if (!resolved.authenticated) throw new Error("DeepSeek model authentication is unavailable")
    },
    () => {
      throw new Error("DeepSeek model preflight failed")
    },
  )
}

function parseModelRef(value: string) {
  const parts = value.trim().split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("FEISHU_MODEL must use providerID/modelID")
  return { providerID: parts[0], modelID: parts[1] }
}

function parsePositiveInteger(value: string | undefined, field: string, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  throw new Error(`${field} must be a positive integer`)
}
