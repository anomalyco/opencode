import { Effect, Option, Predicate, Schema } from "effect"

export type Highlight = {
  title: string
  description: string
  media?: { type: "image" | "video"; src: string; alt?: string }
}

/** What a parsed changelog feed says about the update from `previous` to `current`. */
export type WhatsNewFeed =
  | { readonly status: "highlights"; readonly highlights: Highlight[] }
  | { readonly status: "seen" }
  | { readonly status: "unavailable" }

/** An optional field that reads as absent when it holds anything else, as the changelog is read leniently. */
function lenient<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const field = Schema.optional(schema)

  return Schema.catchDecoding<typeof field>(() => Effect.succeed(Option.none()))(field)
}

/** A list entry that reads as undefined when it is malformed, so the rest of the list still counts. */
function entry<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const item = Schema.UndefinedOr(schema)

  return Schema.catchDecoding<typeof item>(() => Effect.succeed(Option.some(undefined)))(item)
}

const Text = lenient(Schema.Union([Schema.String, Schema.Number]))

const Media = Schema.Struct({ type: Text, src: Text, url: Text })

const Item = Schema.Struct({ title: Text, description: Text, shortDescription: Text, media: lenient(Media) })

const Group = Schema.Struct({ ...Item.fields, source: Text, items: lenient(Schema.Array(entry(Item))) })

const Section = Schema.Struct({ title: Text, items: lenient(Schema.Array(entry(Text))) })

const Release = Schema.Struct({
  tag: Text,
  tag_name: Text,
  name: Text,
  highlights: lenient(Schema.Array(entry(Group))),
  sections: lenient(Schema.Array(entry(Section))),
})

const Releases = Schema.Array(entry(Release))

const Changelog = Schema.Union([Releases, Schema.Struct({ releases: Releases })])

/** Leniently decodes the fetched changelog at the fetch boundary; absent when the feed cannot be read at all. */
export const decodeFeed = Schema.decodeUnknownOption(Changelog)

/**
 * Reads a decoded changelog feed for an update. A current release in the feed with no desktop content marks the
 * version as seen. A feed that cannot be read, or that predates the current release, is unavailable so the check
 * retries on the next start instead of silently consuming the update.
 */
export function readFeed(
  decoded: Option.Option<typeof Changelog.Type>,
  current: string,
  previous: string,
): WhatsNewFeed {
  return Option.match(decoded, {
    onNone: () => ({ status: "unavailable" }),
    onSome: (changelog) => {
      const list = releases(changelog)
      const highlights = sliceHighlights(list, current, previous)

      if (highlights.length > 0) return { status: "highlights", highlights }

      return includesRelease(list, current) ? { status: "seen" } : { status: "unavailable" }
    },
  })
}

type ReleaseHighlights = { tag?: string; highlights: Highlight[] }

function releases(changelog: typeof Changelog.Type): ReleaseHighlights[] {
  return ("releases" in changelog ? changelog.releases : changelog).flatMap((release) => {
    if (!release) return []

    return [{ tag: text(release.tag) ?? text(release.tag_name) ?? text(release.name), highlights: releaseHighlights(release) }]
  })
}

/**
 * Desktop highlights first from `highlights` groups whose source names Desktop, then from the Desktop `section` whose
 * bullets carry a bold lead-in. The section backs a release whose Highlights bullets could not be attributed to
 * Desktop.
 */
function releaseHighlights(release: NonNullable<(typeof Release.Type)[]>[number]): Highlight[] {
  const groups = release.highlights ?? []
return groups.flatMap(group => group.items ?? [])
}


/** A section bullet shaped `- **Title**: description`; section bullets without that lead-in stay in the changelog page. */
function sectionHighlight(item: string): Option.Option<Highlight> {
  const match = /^\*\*(.+?)\*\*:?\s*(.*)$/.exec(item.trim())

  if (!match) return Option.none()

  const title = inlineText(match[1].replace(/:$/, ""))
  const description = inlineText(match[2])

  if (!title || !description) return Option.none()

  return Option.some({ title, description })
}

function inlineText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function readMedia(value: typeof Media.Type | undefined, alt: string): Highlight["media"] {
  const type = text(value?.type)?.toLowerCase()
  const src = text(value?.src) ?? text(value?.url)

  if (!src) return

  if (type !== "image" && type !== "video") return

  return { type, src, alt }
}

/** A trimmed, non-empty string, or a number written out. */
function text(value: string | number | undefined) {
  if (Predicate.isNumber(value)) return String(value)

  return value?.trim() || undefined
}

function normalizeVersion(value: string | undefined) {
  const valueText = value?.trim()

  if (!valueText) return

  return valueText.startsWith("v") || valueText.startsWith("V") ? valueText.slice(1) : valueText
}

function includesRelease(list: ReleaseHighlights[], current: string) {
  const now = normalizeVersion(current)

  if (!now) return list.length > 0

  return list.some((release) => normalizeVersion(release.tag) === now)
}

function sliceHighlights(list: ReleaseHighlights[], current: string, previous: string) {
  const now = normalizeVersion(current)
  const before = normalizeVersion(previous)

  const start = (() => {
    if (!now) return 0

    const index = list.findIndex((release) => normalizeVersion(release.tag) === now)

    return index === -1 ? 0 : index
  })()

  const end = (() => {
    if (!before) return list.length

    const index = list.findIndex((release, i) => i >= start && normalizeVersion(release.tag) === before)

    return index === -1 ? list.length : index
  })()

  const seen = new Set<string>()

  return list
    .slice(start, end)
    .flatMap((release) => release.highlights)
    .filter((item) => {
      const key = [item.title, item.description, item.media?.type ?? "", item.media?.src ?? ""].join("\n")

      if (seen.has(key)) return false

      seen.add(key)

      return true
    })
    .slice(0, 5)
}
