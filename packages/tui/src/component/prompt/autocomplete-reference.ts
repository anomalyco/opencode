import type { LocationRef, ReferenceInfo } from "@opencode-ai/sdk/v2"

export type ReferenceFileSearch = {
  reference: ReferenceInfo
  query: string
  prefix: string
  location: LocationRef
}

export function findExactReferenceAlias(query: string, references: readonly ReferenceInfo[]) {
  if (!query || query.includes("/")) return
  return references.find((reference) => !reference.hidden && reference.name === query)
}

export function resolveReferenceFileSearch(
  query: string,
  references: readonly ReferenceInfo[],
): ReferenceFileSearch | undefined {
  const slash = query.indexOf("/")
  if (slash === -1) return

  const alias = query.slice(0, slash)
  if (!alias) return

  const reference = references.find((item) => !item.hidden && item.name === alias)
  if (!reference) return

  return {
    reference,
    query: query.slice(slash + 1),
    prefix: `${alias}/`,
    location: {
      directory: reference.path,
    },
  }
}

export function withReferenceFilePrefix(prefix: string, filePath: string) {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\/+/, "")
  return `${prefix}${normalized}`
}
