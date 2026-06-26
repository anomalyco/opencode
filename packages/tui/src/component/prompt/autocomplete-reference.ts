export type AutocompleteReference = {
  name: string
  path: string
  hidden?: boolean
}

export function findReferenceAlias(query: string, references: readonly AutocompleteReference[]) {
  const slash = query.indexOf("/")
  const alias = slash === -1 ? query : query.slice(0, slash)
  return references.find((item) => !item.hidden && item.name === alias)
}

export function findReferencePath(query: string, references: readonly AutocompleteReference[]) {
  const slash = query.indexOf("/")
  if (slash === -1) return

  const reference = findReferenceAlias(query, references)
  if (!reference) return

  return {
    reference,
    query: query.slice(slash + 1),
  }
}

export function referenceMentionPath(referenceName: string, filePath: string) {
  return `${referenceName}/${filePath.replaceAll("\\", "/").replace(/^\/+/, "")}`
}
