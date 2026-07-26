export type HomeSessionSearchSnippetSegment = {
  text: string
  match: boolean
}

export function settledHomeSessionSearchResult<T>(query: { isSuccess: boolean; data: T | undefined }) {
  // Solid Query suspends when data is read during the first lazy fetch, which replaces the home tree at its boundary.
  return query.isSuccess ? query.data : undefined
}

export function isHomeSessionSearchResultCurrent(
  result: { query: string; server: string; scope: string },
  current: { query: string; server: string; scope: string },
) {
  return result.query === current.query && result.server === current.server && result.scope === current.scope
}

export function mergeHomeSessionSearchResults<T>(input: { local: T[]; remote?: T[]; key: (item: T) => string }) {
  if (!input.remote) return input.local
  return [...new Map([...input.local, ...input.remote].map((item) => [input.key(item), item])).values()]
}

export function findHomeSessionSearchResult(root: ParentNode | undefined, key: string) {
  return [...(root?.querySelectorAll<HTMLElement>("[data-key]") ?? [])].find((element) => element.dataset.key === key)
}

export function splitHomeSessionSearchSnippet(snippet: string, query: string): HomeSessionSearchSnippetSegment[] {
  const term = query.trim()
  if (!term) return [{ text: snippet, match: false }]
  const start = snippet.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
  if (start === -1) return [{ text: snippet, match: false }]
  return [
    { text: snippet.slice(0, start), match: false },
    { text: snippet.slice(start, start + term.length), match: true },
    { text: snippet.slice(start + term.length), match: false },
  ].filter((segment) => segment.text)
}
