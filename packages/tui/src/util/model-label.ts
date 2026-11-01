// The shortest provider and model names that still tell the connected models apart, matching the desktop composer.

export type ModelLabel = { provider?: string; model: string }

type Provider = { id: string; name: string; canonical?: string; integrationID?: string }

type Model = { providerID: string; id: string; name: string; status?: string }

export function modelLabelKey(providerID: string, modelID: string) {
  return JSON.stringify([providerID, modelID])
}

export function modelName(name: string) {
  return name.replace("(latest)", "").trim()
}

// Native Console models need no provider. A managed provider drops its workspace, and says it routes through
// OpenCode only when the same provider is also connected directly.
export function modelProviderName(providerID: string, providers: readonly Provider[]) {
  const provider = providers.find((item) => item.id === providerID)

  if (!provider) return providerID
  if (native(provider)) return
  const prefix = consolePrefix(providers)

  const name =
    provider.integrationID === "opencode" && prefix && provider.name.startsWith(prefix)
      ? provider.name.slice(prefix.length)
      : provider.name

  if (provider.integrationID !== "opencode" || !provider.canonical) return name

  const direct = providers.some(
    (item) =>
      !native(item) && item.integrationID !== "opencode" && (item.integrationID ?? item.id) === provider.canonical,
  )

  return direct ? `OpenCode / ${name}` : name
}

export function modelLabels(providers: readonly Provider[], models: readonly Model[]): ReadonlyMap<string, ModelLabel> {
  const names = new Map(providers.map((provider) => [provider.id, modelProviderName(provider.id, providers)]))

  const rows = models
    .filter((model) => names.has(model.providerID) && model.status !== "deprecated")
    .map((model) => {
      const provider = names.get(model.providerID)
      const label = modelName(model.name)

      return {
        key: modelLabelKey(model.providerID, model.id),
        providerID: model.providerID,
        modelID: model.id,
        provider,
        model: label,
        text: provider ? `${provider} / ${label}` : label,
      }
    })

  const groups = Map.groupBy(rows, (row) => row.text)

  return new Map(
    rows.map((row) => {
      const peers = groups.get(row.text) ?? []
      const provider = peers.some((other) => other.providerID !== row.providerID) ? row.providerID : row.provider
      const same = peers.filter((other) => other.providerID === row.providerID).map((other) => other.modelID)
      const suffix = same.length > 1 ? row.modelID.slice(sharedPrefix(same)).replace(/^[-_./:]+/, "") : ""

      return [row.key, { provider, model: suffix ? `${row.model} (${suffix})` : row.model }]
    }),
  )
}

// The part of the IDs they all share, cut back to a separator so "v1" and "v2" share nothing
// while "gemini-4-argon" and "gemini-4-argon-eap" share "gemini-4-argon".
function sharedPrefix(ids: string[]) {
  const first = ids[0] ?? ""
  const separator = (char: string | undefined) => !!char && /[-_./:]/.test(char)

  const boundary = (n: number) =>
    n === 0 || ids.every((id) => n === id.length || separator(id[n]) || separator(id[n - 1]))

  const differs = first.split("").findIndex((char, index) => ids.some((id) => id[index] !== char))
  const common = differs === -1 ? first.length : differs

  return Array.from({ length: common + 1 }, (_, index) => common - index).find(boundary) ?? 0
}

// A Console-managed provider is named "<Workspace> / <Provider>", like its root "<Workspace> / OpenCode".
function consolePrefix(providers: readonly Provider[]) {
  const root = providers.find((provider) => provider.id === "opencode" && provider.integrationID === "opencode")
  const suffix = " / OpenCode"

  if (!root?.name.endsWith(suffix)) return
  const workspace = root.name.slice(0, -suffix.length).trim()

  return workspace ? `${workspace} / ` : undefined
}

function native(provider: Provider) {
  return provider.id === "opencode" && (!provider.integrationID || provider.integrationID === "opencode")
}
