import type { HistoryPage } from "./ipc"
import { matchQuality, MISS, parseQuery, searchText } from "./match"
import { completion, pageKey } from "./page"
import type { Visit } from "./visits"

/** How many pages the address field asks main for: a few more than it lists, as the window's own pages join them. */
export const HISTORY_ANSWER = 8

/**
 * A page the address field suggests. `completion` is the rest of its address after what was typed: empty when the
 * text is the whole address, undefined when the address does not begin with it.
 */
export type Suggestion = Visit & { readonly completion: string | undefined }

/**
 * The pages the address field lists for what the person typed, best first: by how well each matches, then by how
 * often and how recently it was visited. `answer` is main's last answer, which may be to an earlier text, so each of
 * its pages is matched again and narrows at once; `visits` is the window's list of the last pages, newest first,
 * which answers before main does, adds what main never keeps (files, previews, artifacts) and gives a page its icon.
 */
export function suggestPages(text: string, visits: readonly Visit[], answer: readonly HistoryPage[], limit: number): Suggestion[] {
  const query = parseQuery(text)

  if (!query) return []
  // A page with no key is one main never keeps, which only its own address names.
  const key = (visit: Visit) => pageKey(visit.url) ?? `${visit.url}\n${visit.session ?? ""}`
  const listed = new Map(visits.map((visit) => [key(visit), visit]))
  const answered = new Set(answer.map((page) => pageKey(page.url)))

  const candidates = [
    ...answer.map((page) => {
      const known = listed.get(pageKey(page.url) ?? "")
      const visit: Visit = { url: page.url, title: page.title || known?.title || "" }

      // An imported page has no icon; one the window showed lately lends its own.
      return { visit: known?.icon ? { ...visit, icon: known.icon } : visit, score: page.score }
    }),
    // A page of the window's list that main did not answer with counts as visited once, the newest the most recent.
    ...visits.flatMap((visit, position) => (answered.has(pageKey(visit.url) ?? "") ? [] : [{ visit, score: 1 - position / 1000 }])),
  ]

  return candidates
    .flatMap((candidate) => {
      const quality = matchQuality(query, searchText(candidate.visit.url, candidate.visit.title))

      return quality === MISS ? [] : [{ ...candidate, quality }]
    })
    .toSorted((a, b) => b.quality - a.quality || b.score - a.score)
    .slice(0, limit)
    .map((found) => ({ ...found.visit, completion: completion(text.trimStart(), found.visit.url) }))
}
