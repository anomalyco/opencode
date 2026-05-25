const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

export type CustomProviderModel = {
  id: string
  name: string
}

export type CustomProviderHeader = {
  key: string
  value: string
}

export type CustomProviderForm = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: CustomProviderModel[]
  headers: CustomProviderHeader[]
}

type ValidateArgs = {
  form: CustomProviderForm
  disabledProviders: string[]
  existingProviderIDs: Set<string>
}

export type CustomProviderValidation =
  | {
      ok: true
      providerID: string
      name: string
      key?: string
      config: {
        npm: typeof OPENAI_COMPATIBLE
        name: string
        env?: string[]
        options: {
          baseURL: string
          headers?: Record<string, string>
        }
        models: Record<string, { name: string }>
      }
    }
  | {
      ok: false
      error: string
    }

export function validateCustomProvider(input: ValidateArgs): CustomProviderValidation {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  if (!providerID) return { ok: false, error: "Provider ID is required" }
  if (!PROVIDER_ID.test(providerID)) {
    return { ok: false, error: "Provider ID can only contain lowercase letters, numbers, hyphens, and underscores" }
  }
  if (input.existingProviderIDs.has(providerID) && !input.disabledProviders.includes(providerID)) {
    return { ok: false, error: "Provider ID already exists" }
  }
  if (!name) return { ok: false, error: "Display name is required" }
  if (!baseURL) return { ok: false, error: "Base URL is required" }
  if (!/^https?:\/\//.test(baseURL)) return { ok: false, error: "Base URL must start with http:// or https://" }

  const seenModels = new Set<string>()
  const models: Record<string, { name: string }> = {}
  for (const model of input.form.models) {
    const id = model.id.trim()
    const modelName = model.name.trim()
    if (!id) return { ok: false, error: "Model ID is required" }
    if (!modelName) return { ok: false, error: "Model name is required" }
    if (seenModels.has(id)) return { ok: false, error: `Duplicate model ID: ${id}` }
    seenModels.add(id)
    models[id] = { name: modelName }
  }

  const headers: Record<string, string> = {}
  const seenHeaders = new Set<string>()
  for (const header of input.form.headers) {
    const key = header.key.trim()
    const value = header.value.trim()
    if (!key && !value) continue
    if (!key) return { ok: false, error: "Header name is required" }
    if (!value) return { ok: false, error: "Header value is required" }
    const normalized = key.toLowerCase()
    if (seenHeaders.has(normalized)) return { ok: false, error: `Duplicate header: ${key}` }
    seenHeaders.add(normalized)
    headers[key] = value
  }

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  return {
    ok: true,
    providerID,
    name,
    key,
    config: {
      npm: OPENAI_COMPATIBLE,
      name,
      ...(env ? { env: [env] } : {}),
      options: {
        baseURL,
        ...(Object.keys(headers).length ? { headers } : {}),
      },
      models,
    },
  }
}
