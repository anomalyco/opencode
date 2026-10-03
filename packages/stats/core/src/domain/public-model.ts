import { Resource } from "sst/resource"

// The source names belong in a private runtime secret, never in the public site source.
const aliases = parsePublicModelAliases(Resource.StatsPublicModelAliases.value)

export function parsePublicModelAliases(value: string) {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid public model aliases")
  const entries = Object.entries(parsed)
  if (
    entries.some(
      ([source, name]) =>
        !/^[a-z0-9-]+\/[a-z0-9.-]+$/.test(source) ||
        typeof name !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9 .-]*$/.test(name),
    )
  )
    throw new Error("Invalid public model aliases")
  const names = entries.map(([source, name]) => `${source.split("/")[0]}/${slug(String(name))}`)
  if (new Set(names).size !== names.length || names.some((name) => Object.hasOwn(parsed, name)))
    throw new Error("Public model alias collides with a source name")
  return parsed as Record<string, string>
}

export function publicModelName(provider: string, model: string) {
  return aliases[`${provider}/${model}`] ?? model
}

export function sourceModelName(provider: string, model: string) {
  const match = Object.entries(aliases).find(
    ([source, name]) => source.startsWith(`${provider}/`) && slug(name) === slug(model),
  )
  return match?.[0].slice(provider.length + 1) ?? model
}

export function isSourceModel(provider: string, model: string) {
  return Object.hasOwn(aliases, `${provider.toLowerCase()}/${model.toLowerCase()}`)
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
