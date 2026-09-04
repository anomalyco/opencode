import type { McpAddInput } from "@opencode-ai/client/promise"

export type McpServerConfig = McpAddInput["config"]

export type McpFormState = {
  name: string
  kind: "local" | "remote"
  command: string[]
  cwd: string
  environment: { key: string; value: string }[]
  url: string
  headers: { key: string; value: string }[]
  oauthEnabled: boolean
  oauthDisableAutodetect: boolean
  clientId: string
  clientSecret: string
  clientSecretPlaceholder?: string
  scope: string
  callbackPort: string
  enabled: boolean
  timeout: string
}

const SECRET_PLACEHOLDER = "configured"

export function emptyForm(name?: string): McpFormState {
  return {
    name: name ?? "",
    kind: "local",
    command: [],
    cwd: "",
    environment: [],
    headers: [],
    url: "",
    oauthEnabled: false,
    oauthDisableAutodetect: false,
    clientId: "",
    clientSecret: "",
    clientSecretPlaceholder: undefined,
    scope: "",
    callbackPort: "",
    enabled: true,
    timeout: "",
  }
}

function timeoutFromConfig(config: McpServerConfig) {
  const value = config.timeout
  if (!value) return ""
  return String(value.execution ?? value.catalog ?? value.startup ?? "")
}

export function formFromConfig(name: string, config: McpServerConfig): McpFormState {
  if (config.type === "local") {
    return {
      ...emptyForm(name),
      kind: "local",
      command: [...config.command],
      cwd: config.cwd ?? "",
      environment: rowsFrom(config.environment),
      enabled: !config.disabled,
      timeout: timeoutFromConfig(config),
    }
  }
  const oauth = config.oauth
  const settings = oauth === false || oauth === undefined ? undefined : oauth
  return {
    ...emptyForm(name),
    kind: "remote",
    url: config.url,
    headers: rowsFrom(config.headers),
    oauthEnabled: oauth !== undefined,
    oauthDisableAutodetect: oauth === false,
    clientId: settings?.client_id ?? "",
    clientSecret: "",
    clientSecretPlaceholder: settings?.client_secret === undefined ? undefined : SECRET_PLACEHOLDER,
    scope: settings?.scope ?? "",
    callbackPort: settings?.callback_port === undefined ? "" : String(settings.callback_port),
    enabled: !config.disabled,
    timeout: timeoutFromConfig(config),
  }
}

function rowsFrom(record: Record<string, string> | undefined) {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }))
}

function cleanRows(rows: { key: string; value: string }[]) {
  return rows.filter((row) => row.key.trim() !== "")
}

function toRecord(rows: { key: string; value: string }[]) {
  const kept = cleanRows(rows)
  if (kept.length === 0) return undefined
  return Object.fromEntries(kept.map((row) => [row.key.trim(), row.value]))
}

function parsePort(value: string) {
  const trimmed = value.trim()
  if (trimmed === "") return { ok: true as const, value: undefined }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return { ok: false as const, error: "callbackPort" }
  return { ok: true as const, value: parsed }
}

function parseTimeout(value: string) {
  const trimmed = value.trim()
  if (trimmed === "") return { ok: true as const, value: undefined }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false as const, error: "timeout" }
  return { ok: true as const, value: parsed }
}

// keepSecret is accepted for edit flows (remove+add round-trip): a blank
// secret with the "configured" sentinel always omits client_secret so the
// server-held credential is preserved. The flag itself is behaviorally inert
// today; it is threaded through so Task 2's edit path stays stable if the
// round-trip later needs to distinguish "keep" from "fresh add".
export function buildAddInput(
  form: McpFormState,
  _opts: { keepSecret?: boolean } = {},
): { ok: true; input: { server: string; config: McpServerConfig } } | { ok: false; error: string } {
  const name = form.name.trim()
  if (name === "") return { ok: false, error: "name" }

  const timeout = parseTimeout(form.timeout)
  if (!timeout.ok) return timeout
  const timeoutConfig = timeout.value !== undefined ? { startup: timeout.value, catalog: timeout.value, execution: timeout.value } : undefined
  const disabled = !form.enabled || undefined

  if (form.kind === "local") {
    const command = form.command.map((part) => part.trim()).filter((part) => part !== "")
    if (command.length === 0) return { ok: false, error: "command" }
    const environment = toRecord(form.environment)
    const config: McpServerConfig = {
      type: "local",
      command,
      cwd: form.cwd.trim() === "" ? undefined : form.cwd.trim(),
      environment,
      disabled,
      timeout: timeoutConfig,
    }
    return { ok: true, input: { server: name, config } }
  }

  if (form.url.trim() === "") return { ok: false, error: "url" }
  const oauth = form.oauthEnabled ? buildOauth(form) : undefined
  if (typeof oauth === "string") return { ok: false, error: oauth }
  const config: McpServerConfig = {
    type: "remote",
    url: form.url.trim(),
    headers: toRecord(form.headers),
    oauth,
    disabled,
    timeout: timeoutConfig,
  }
  return { ok: true, input: { server: name, config } }
}

// Returns the oauth config, or an error key when a numeric field is invalid.
function buildOauth(form: McpFormState) {
  if (form.oauthDisableAutodetect) return false as const
  const port = parsePort(form.callbackPort)
  if (!port.ok) return port.error
  const oauth: { client_id?: string; client_secret?: string; scope?: string; callback_port?: number } = {}
  if (form.clientId.trim() !== "") oauth.client_id = form.clientId.trim()
  // A blank secret with the "configured" sentinel means the server still
  // holds the previous credential: omitting client_secret preserves it.
  if (form.clientSecret.trim() !== "") oauth.client_secret = form.clientSecret
  if (form.scope.trim() !== "") oauth.scope = form.scope.trim()
  if (port.value !== undefined) oauth.callback_port = port.value
  return oauth
}