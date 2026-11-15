// Ported from the OpenCode iOS app's `VoiceSessionSearch` and `VoiceDelegatorWorkspace.matching`: spoken
// names arrive with filler, in any order and sometimes misheard.
const filler = new Set([
  "a",
  "an",
  "the",
  "my",
  "our",
  "that",
  "this",
  "one",
  "ones",
  "session",
  "sessions",
  "about",
  "for",
  "on",
  "in",
  "of",
  "to",
  "and",
  "with",
  "chat",
  "conversation",
  "called",
  "named",
])

export class SessionSearch {
  readonly phrase: string
  readonly terms: string[]

  constructor(query: string) {
    this.phrase = normalize(query)
    const words = this.phrase.split(" ").filter(Boolean)
    const meaningful = words.filter((word) => !filler.has(word))
    this.terms = meaningful.length ? meaningful : words
  }

  /** The most specific word, for a second server search when the phrase as a whole matches no title. */
  get longestTerm() {
    return this.terms.reduce<string | undefined>(
      (longest, term) => (term.length > (longest?.length ?? 0) ? term : longest),
      undefined,
    )
  }

  /** Undefined when the session doesn't match; higher is better. */
  score(session: { title?: string; location: { directory: string } }) {
    if (!this.terms.length) return
    const title = normalize(session.title ?? "")

    // The meaningful words count as the phrase too: "the hex session" names HEX exactly.
    const named = this.terms.join(" ")

    if (title === this.phrase || title === named) return 100

    if (title.includes(this.phrase) || title.includes(named)) return 80
    const words = `${title} ${normalize(folder(session.location.directory))}`.split(" ").filter(Boolean)
    const joined = words.join("")

    const matched = this.terms.filter(
      (term) =>
        words.some((word) => word.startsWith(term) || (term.length >= 5 && withinOneEdit(word, term))) ||
        (term.length >= 4 && joined.includes(term)),
    ).length

    if (matched === this.terms.length) return 50 + matched * 5

    if (matched > 0 && matched * 2 >= this.terms.length) return 20 + matched * 5
  }
}

/** Models matching a spoken query, most words matched first, each word matching the start of a word in the name or ID. */
export function matchModels<T extends { id: string; name: string; providerID: string }>(models: T[], query?: string) {
  const terms = modelWords(query ?? "")

  if (!terms.length) return models

  return models
    .map((model, index) => {
      const haystack = modelWords(`${model.name} ${model.providerID}/${model.id}`)

      return { model, index, hits: terms.filter((term) => haystack.some((word) => word.startsWith(term))).length }
    })
    .filter((item) => item.hits > 0)
    .toSorted((a, b) => b.hits - a.hits || a.index - b.index)
    .map((item) => item.model)
}

export function folder(directory: string) {
  return directory.split("/").filter(Boolean).at(-1) ?? directory
}

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

// Keeps a version's dots ("5.5"), so "gpt 5.5" doesn't also match GPT-5.4 through a lone "5".
function modelWords(text: string) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean)
}

function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }

    if (++edits > 1) return false

    if (a.length >= b.length) i++

    if (a.length <= b.length) j++
  }

  return edits + (a.length - i) + (b.length - j) <= 1
}
