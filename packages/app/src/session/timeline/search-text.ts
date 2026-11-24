import type { SearchablePart, SearchableSource } from "./search-machine"

/**
 * How much Markdown source one request to the worker carries. The worker reads that much in 3 ms, and in about 10 ms
 * before its parser has warmed up, so a reply that renders meanwhile waits no longer behind it. The main thread
 * copies a request and its answer in well under a millisecond.
 */
export const SEARCH_TEXT_SLICE = 32_000

type Entry = {
  readonly source: string
  /** The text Find counts in, lowercased. Absent until a query needs it or a reading gives it. */
  lower: string | undefined
  /** `lower` is a reading of `source`: the worker's, or what the part shows where it is rendered. */
  read: boolean
  /** A reading of `source` is queued or under way. */
  asked: boolean
  /** What `parts` last gave for this entry. A part whose text is read again is a new object. */
  part: SearchablePart | undefined
}

/**
 * The text Find counts in, for each part of a transcript. Find counts what a part shows, not its Markdown source: a
 * marker, the destination behind a link's label and an entity's name are in the source and nowhere on screen.
 * - A part is read by the Markdown worker (`read`), a slice at a time, oldest part first.
 * - A part that is mounted is read where it is rendered (`rendered`), and that reading replaces the worker's.
 * - Until a part is read, it counts as its source. So does the end that a reply which streams has grown since it was
 *   read. Its message is read by the worker once it is complete.
 * `changed` is called when a reading changes a text that `parts` has given out. It takes the parts' sources and not
 * the transcript: reading 6,468 messages out of the store takes tens of milliseconds, and a reading must not repeat it.
 */
export function createSearchText(input: {
  read: (sources: readonly string[]) => Promise<readonly string[]>
  changed: () => void
}) {
  // Not a signal store: `parts` runs for every part of the transcript whenever a message changes.
  let entries = new Map<string, Entry>()
  const waiting = new Map<string, Entry>()
  // One request at a time, so the worker takes a slice between two renders and not the whole transcript before one.
  let reading = false

  function see(item: SearchableSource) {
    const known = entries.get(item.partID)

    if (known?.source === item.text) return ask(item, known)

    const entry: Entry = {
      source: item.text,
      // A reply that streams grows at its end: what was read of it stays, and the new end counts as its source.
      lower:
        known?.lower !== undefined && item.text.startsWith(known.source)
          ? known.lower + item.text.slice(known.source.length).toLowerCase()
          : undefined,
      read: !item.markdown,
      asked: false,
      part: undefined,
    }

    entries.set(item.partID, entry)

    return ask(item, entry)
  }

  function ask(item: SearchableSource, entry: Entry) {
    if (entry.read || entry.asked || !item.markdown || !item.settled) return entry
    entry.asked = true
    waiting.set(item.partID, entry)

    return entry
  }

  function pump() {
    if (reading || waiting.size === 0) return
    const slice: { partID: string; entry: Entry }[] = []
    let size = 0

    for (const [partID, entry] of waiting) {
      if (slice.length > 0 && size + entry.source.length > SEARCH_TEXT_SLICE) break
      waiting.delete(partID)
      entry.asked = false

      // The part changed or left the transcript while it waited.
      if (entries.get(partID) !== entry || entry.read) continue
      entry.asked = true
      slice.push({ partID, entry })
      size += entry.source.length
    }

    if (slice.length === 0) return
    reading = true
    input.read(slice.map((item) => item.entry.source)).then(
      (texts) => {
        reading = false
        const given = slice.filter((item, index) => {
          item.entry.asked = false

          // A part read where it is rendered meanwhile keeps that reading.
          if (entries.get(item.partID) !== item.entry || item.entry.read) return false
          const lower = texts[index].toLowerCase()
          const differs = item.entry.lower !== undefined && item.entry.lower !== lower
          item.entry.lower = lower
          item.entry.read = true

          return differs
        })

        if (given.length > 0) input.changed()
        pump()
      },
      // The worker is gone or cooling down. These parts go on counting as their source, and are asked for again
      // with the next transcript Find is given. The rest of the queue waits for that too, so a worker that is down
      // gets one request for each change and not one for each slice.
      () => {
        reading = false
        slice.forEach((item) => (item.entry.asked = false))
      },
    )
  }

  return {
    /** Starts reading a transcript before a query needs it: when Find opens. Lowercases nothing. */
    prime(sources: readonly SearchableSource[]) {
      sources.forEach(see)
      pump()
    },

    /** The parts of a transcript in timeline order, each with the text Find counts in. */
    parts(sources: readonly SearchableSource[]): readonly SearchablePart[] {
      const kept = new Map<string, Entry>()

      const parts = sources.map((item) => {
        const entry = see(item)
        entry.lower ??= entry.source.toLowerCase()

        if (entry.part?.lower !== entry.lower)
          entry.part = { revealID: item.revealID, partID: item.partID, lower: entry.lower }
        kept.set(item.partID, entry)

        return entry.part
      })

      // Parts that left the transcript are forgotten: a reverted message, another session.
      entries = kept
      pump()

      return parts
    },

    /** The text a mounted part shows, lowercased, once its Markdown has rendered. */
    rendered(partID: string, lower: string) {
      const entry = entries.get(partID)

      if (!entry) return
      entry.read = true

      if (entry.lower === lower) return
      const given = entry.lower !== undefined
      entry.lower = lower

      if (given) input.changed()
    },
  }
}
