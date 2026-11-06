// Turns GitHub release notes into the changelog timeline: one entry per release (tiny releases on
// the same day merge), each with a title and summary taken from the notes themselves.

import type { ChangelogRelease } from "~/lib/changelog"

/**
 * A highlight or breaking change: a short title and the text below it. `areas` are the note
 * sections it touches; `prs` the pull requests it links and `credits` the GitHub users it thanks,
 * both kept out of the text and shown after it.
 */
export type ChangelogFeature = { title: string; body: string; areas: string[]; prs: string[]; credits: string[] }
/** One improvement or fix, as Markdown, with the note sections (Core, TUI, Desktop…) it was listed under. */
export type ChangelogNote = { text: string; areas: string[]; prs: string[]; credits: string[] }
/** An image or video in the release notes, with its text alternative (empty when the notes give none). */
export type ChangelogMedia = { type: "image" | "video"; src: string; alt: string }

export type ReleaseNotes = {
  features: ChangelogFeature[]
  breaking: ChangelogFeature[]
  improved: ChangelogNote[]
  fixed: ChangelogNote[]
  media: ChangelogMedia[]
}

export type ChangelogEntry = {
  /** `YYYY-MM-DD`, in UTC. */
  date: string
  /** Newest first; the first tag names the entry's page, `/changelog/<tag>`. */
  releases: { tag: string; url: string }[]
  title: string
  summary: string
  /** The pull requests and credits of the highlight or note the title and summary come from. */
  refs: { prs: string[]; credits: string[] }
  features: ChangelogFeature[]
  breaking: ChangelogFeature[]
  improved: ChangelogNote[]
  fixed: ChangelogNote[]
  media: ChangelogMedia[]
}

/** An area the notes are filed under: its key in `?area=`, and its label. */
export type ChangelogArea = { key: string; label: string }

/**
 * What one changelog view shows: a page of the timeline (or one entry, with its neighbours), the
 * areas there are to filter by and the ones chosen. `areas` are the product areas; `headings` are
 * every section heading the notes use, one-off ones from old releases too (Settings › Changelog
 * filters: "all headings"). `ok` is false when no releases loaded at all.
 */
export type ChangelogView = {
  ok: boolean
  entries: ChangelogEntry[]
  page: number
  pages: number
  areas: ChangelogArea[]
  headings: ChangelogArea[]
  filter: string[]
  /** For one entry: the newer and older entries next to it. */
  newer?: { tag: string; title: string }
  older?: { tag: string; title: string }
  /** The releases are a stand-in (the build snapshot or the last good list) because GitHub failed just now. */
  stale?: boolean
}

/** Entries per changelog page. */
export const changelogPageSize = 10

export type BodyBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; lang: string; text: string }

const pullRequest = /\[#(\d+)\]\([^)]*\)/g

/**
 * Reads both release note formats: v2 (`### Highlights`, `### Core` › `#### Bug fixes`) and v1
 * (`## Core` › `### Bugfixes`). Notes repeated from a highlight (same pull requests) are dropped,
 * and the same note listed under several sections is kept once with all of them.
 */
export function parseReleaseNotes(body: string): ReleaseNotes {
  const highlights: string[] = []
  const breaking: { title: string; lines: string[] }[] = []
  const notes: { text: string; area: string; kind: "improved" | "fixed" }[] = []
  let mode: "none" | "highlights" | "breaking" | "notes" = "none"
  let breakingLevel = 0
  let area = ""
  let kind: "improved" | "fixed" = "improved"
  let fence = false

  const media = releaseMedia(body)
  for (const line of body.replace(/\r/g, "").split("\n")) {
    const fenceLine = line.trimStart().startsWith("```")
    if (fence || fenceLine) {
      if (fenceLine) fence = !fence
      if (mode === "breaking") breakingItem(breaking).lines.push(line)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading) {
      const level = heading[1].length
      const text = heading[2]
      if (/^highlights$/i.test(text)) {
        mode = "highlights"
        continue
      }
      if (/^breaking changes?$/i.test(text)) {
        mode = "breaking"
        breakingLevel = level
        continue
      }
      if (mode === "breaking" && level > breakingLevel) {
        breaking.push({ title: text, lines: [] })
        continue
      }
      const headingKind = noteKind(text)
      if (headingKind) {
        mode = "notes"
        kind = headingKind
        continue
      }
      mode = "notes"
      area = text
      kind = "improved"
      continue
    }

    if (line.startsWith("**Thank you")) {
      mode = "none"
      continue
    }
    if (mode === "breaking") {
      if (line.trim() || breaking.length > 0) breakingItem(breaking).lines.push(line)
      continue
    }
    const item = line.match(/^[-*]\s+(.+)$/)
    if (!item) continue
    if (mode === "highlights") highlights.push(item[1].trim())
    if (mode === "notes") notes.push({ text: item[1].trim(), area, kind })
  }

  const areasFor = (prs: string[]) =>
    unique(notes.filter((note) => pullRequests(note.text).some((pr) => prs.includes(pr))).map((note) => note.area))
  const features = highlights.map((text) => ({ ...feature(text), prs: pullRequests(text), credits: credits(text) }))
  const covered = new Set(features.flatMap((item) => item.prs))
  const kept = notes
    .map((note) => ({ ...note, prs: pullRequests(note.text) }))
    .filter((note) => note.prs.length === 0 || note.prs.some((pr) => !covered.has(pr)))

  return {
    media,
    features: features.map((item) => ({
      title: item.title,
      body: item.body,
      areas: areasFor(item.prs),
      prs: item.prs,
      credits: item.credits,
    })),
    // Breaking changes also count for a section they name, such as "TUI plugins require…".
    breaking: breaking.map((item) => {
      const text = item.lines.join("\n").trim()
      const named = unique(notes.map((note) => note.area)).filter((name) =>
        new RegExp(`\\b${name}\\b`).test(item.title),
      )
      return {
        title: item.title,
        body: stripPullRequests(text),
        areas: unique([...areasFor(pullRequests(text)), ...named]),
        prs: pullRequests(text),
        credits: [],
      }
    }),
    improved: mergeNotes(kept.filter((note) => note.kind === "improved")),
    fixed: mergeNotes(kept.filter((note) => note.kind === "fixed")),
  }
}

/**
 * The timeline, newest first. Releases with no notes for the chosen areas are left out. Unfiltered,
 * tiny releases (no highlights, at most three notes) merge into another release from the same day.
 * Only app releases (`v…` tags) count; package releases such as the process daemon do not.
 */
export function changelogTimeline(releases: ChangelogRelease[], areas?: string[]) {
  const units = releases
    .filter((release) => /^v\d/.test(release.tag))
    .map((release) => ({
      date: release.date.slice(0, 10),
      releases: [{ tag: release.tag, url: release.url }],
      notes: areas ? onlyAreas(release.notes, areas) : release.notes,
    }))
    .filter((unit) => noteCount(unit.notes) > 0)
  const days = units.reduce<(typeof units)[]>((acc, unit) => {
    const last = acc.at(-1)
    if (last?.[0].date === unit.date) last.push(unit)
    else acc.push([unit])
    return acc
  }, [])
  // Merged releases stay newest first, so the newest tag names the entry.
  const order = new Map(releases.map((release, index) => [release.tag, index]))
  const sorted = (unit: (typeof units)[number]) => ({
    ...unit,
    releases: unit.releases.toSorted((a, b) => (order.get(a.tag) ?? 0) - (order.get(b.tag) ?? 0)),
  })
  // Filtered, each release stays its own entry, so it links to the page that shows it: merging
  // would fold a release whose few notes in these areas made it tiny into a different release's page.
  if (areas) return units.map((unit) => entry(unit))
  return days.flatMap((day) => {
    const big = day.filter((unit) => !tiny(unit.notes))
    if (big.length === 0) return [entry(sorted(day.reduce(merge)))]
    return big.map((unit, index) =>
      entry(sorted(index === 0 ? day.filter((item) => tiny(item.notes)).reduce(merge, unit) : unit)),
    )
  })
}

/** Entries grouped by day, for the date column. */
export function changelogDays(entries: ChangelogEntry[]) {
  return entries.reduce<{ date: string; entries: ChangelogEntry[] }[]>((acc, item) => {
    const last = acc.at(-1)
    if (last?.date === item.date) last.entries.push(item)
    else acc.push({ date: item.date, entries: [item] })
    return acc
  }, [])
}

/** The names the site uses for the release note sections. */
export function areaLabel(area: string) {
  if (area === "TUI") return "Terminal"
  return area
}

/** An area's key in `?area=`: its label in lower case, so `?area=terminal` picks the TUI notes. */
export function areaKey(area: string) {
  return areaLabel(area)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
}

/** The product areas the changelog filters by, in this order. */
const productAreaLabels = ["Desktop", "Core", "Terminal", "SDK", "Extensions"]

/**
 * The product area a release note section belongs to. Most releases use the areas themselves (and
 * "TUI" for Terminal); a few old releases used one-off headings, such as "Desktop App Improvements"
 * or "Providers & Models", which go to the area they are about. Headings about no one area ("Misc",
 * "Other Changes", "UI/UX Improvements") have none: their notes show under All only.
 */
export function productArea(area: string) {
  if (/desktop/i.test(area)) return "Desktop"
  if (/\b(tui|terminal)\b/i.test(area)) return "Terminal"
  if (/\bsdk\b/i.test(area)) return "SDK"
  if (/extension|plugin/i.test(area)) return "Extensions"
  if (/^core$|server|provider|model|permission|auth/i.test(area)) return "Core"
}

/** Every area the notes use, most used first. */
export function changelogAreas(releases: ChangelogRelease[]) {
  const counts = releases
    .flatMap((release) => [...release.notes.improved, ...release.notes.fixed].flatMap((note) => note.areas))
    .reduce((acc, area) => acc.set(area, (acc.get(area) ?? 0) + 1), new Map<string, number>())
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([area]) => area)
}

/** Area keys from `?area=` (comma-separated, repeated, or both). */
export function areaKeys(value: string | string[] | undefined | null) {
  return unique(
    [value ?? []]
      .flat()
      .flatMap((item) => item.split(","))
      .map((key) => key.trim().toLowerCase()),
  ).filter(Boolean)
}

/**
 * One page of the timeline, filtered to the areas whose keys are in `filter` (all of them when none
 * is). Pages count from 1; a page past the end shows the last one.
 */
export function changelogView(
  releases: ChangelogRelease[],
  options: { page?: number; filter?: string[]; size?: number } = {},
): ChangelogView {
  const all = changelogAreas(releases)
  // A key picks a heading itself (`?area=misc`) or a product area with all its headings (`?area=core`).
  const keys = (area: string) => [areaKey(area), ...[productArea(area) ?? []].flat().map(areaKey)]
  const chosen = all.filter((area) => keys(area).some((key) => options.filter?.includes(key)))
  // A filter for areas the notes don't use (yet) shows nothing, not everything.
  const entries =
    options.filter && options.filter.length > 0 && chosen.length === 0
      ? []
      : changelogTimeline(releases, chosen.length > 0 ? chosen : undefined)
  const size = options.size ?? changelogPageSize
  const pages = Math.max(1, Math.ceil(entries.length / size))
  const page = Math.min(Math.max(1, Math.floor(options.page ?? 1)), pages)
  return {
    ok: releases.length > 0,
    entries: entries.slice((page - 1) * size, page * size),
    page,
    pages,
    areas: productAreaLabels
      .filter((label) => all.some((area) => productArea(area) === label))
      .map((label) => ({ key: areaKey(label), label })),
    headings: all.map((area) => ({ key: areaKey(area), label: areaLabel(area) })),
    filter: (options.filter ?? []).filter((key) => chosen.some((area) => keys(area).includes(key))),
  }
}

/** The entry that includes the release `tag` (merged entries answer to each of their tags), with its neighbours. */
export function changelogEntryView(releases: ChangelogRelease[], tag: string, stale?: boolean): ChangelogView {
  const entries = changelogTimeline(releases)
  const index = entries.findIndex((item) => item.releases.some((release) => release.tag === tag))
  const link = (item?: ChangelogEntry) => item && { tag: item.releases[0].tag, title: item.title }
  return {
    ok: releases.length > 0,
    entries: index >= 0 ? [entries[index]] : [],
    page: 1,
    pages: 1,
    areas: [],
    headings: [],
    filter: [],
    newer: index > 0 ? link(entries[index - 1]) : undefined,
    older: index >= 0 ? link(entries[index + 1]) : undefined,
    stale,
  }
}

/**
 * The HTTP status of one release's page and JSON. A tag missing from GitHub's own list is a 404; one
 * missing from a stand-in list, or with no list at all, is a 503, because it may be a release the
 * stand-in doesn't have.
 */
export function entryStatus(view: ChangelogView) {
  if (view.entries.length) return 200
  return view.ok && !view.stale ? 404 : 503
}

/** The `?page=…&area=…` query for a changelog view, without the defaults. */
export function changelogQuery(options: { page?: number; filter?: string[] }) {
  const params = [
    options.filter && options.filter.length > 0 && `area=${options.filter.join(",")}`,
    options.page && options.page > 1 && `page=${options.page}`,
  ].filter(Boolean)
  return params.length > 0 ? `?${params.join("&")}` : ""
}

/** A breaking change's text as paragraphs, lists and code blocks. */
export function bodyBlocks(body: string) {
  return body
    .split("\n")
    .reduce<{ blocks: BodyBlock[]; open: boolean }>(
      (acc, line) => {
        const last = acc.blocks.at(-1)
        if (last?.type === "code" && acc.open) {
          if (line.trimStart().startsWith("```")) return { blocks: acc.blocks, open: false }
          last.text = last.text ? `${last.text}\n${line}` : line
          return acc
        }
        if (line.trimStart().startsWith("```"))
          return { blocks: [...acc.blocks, { type: "code", lang: line.trim().slice(3), text: "" }], open: true }
        if (!line.trim()) return { blocks: [...acc.blocks, { type: "p", text: "" }], open: false }
        const item = line.match(/^\s*[-*]\s+(.+)$/)
        if (item && last?.type === "list") {
          last.items.push(item[1])
          return acc
        }
        if (item) return { blocks: [...acc.blocks, { type: "list", items: [item[1]] }], open: false }
        if (last?.type === "p") {
          last.text = last.text ? `${last.text} ${line.trim()}` : line.trim()
          return acc
        }
        return { blocks: [...acc.blocks, { type: "p", text: line.trim() }], open: false }
      },
      { blocks: [], open: false },
    )
    .blocks.filter((block) => block.type !== "p" || block.text)
}

function entry(unit: { date: string; releases: { tag: string; url: string }[]; notes: ReleaseNotes }): ChangelogEntry {
  const notes = unit.notes
  const base = { date: unit.date, releases: unit.releases, ...notes }
  const lead = notes.features[0]
  if (lead)
    return {
      ...base,
      title: lead.title,
      summary: lead.body,
      refs: { prs: lead.prs, credits: lead.credits },
      features: notes.features.slice(1),
    }
  // Without highlights, the first note that reads as a title leads (notes are listed most important first).
  const note = [...notes.improved, ...notes.fixed].find((item) => headline(item.text))
  if (note) {
    const title = headline(note.text)!
    return {
      ...base,
      title,
      summary: plain(note.text).replace(/\.$/, "") === title ? "" : note.text,
      refs: { prs: note.prs, credits: note.credits },
      improved: notes.improved.filter((item) => item !== note),
      fixed: notes.fixed.filter((item) => item !== note),
    }
  }
  return { ...base, title: fallbackTitle(notes), summary: "", refs: { prs: [], credits: [] } }
}

function fallbackTitle(notes: ReleaseNotes) {
  if (notes.improved.length > 0 && notes.fixed.length > 0) return "Improvements and fixes"
  if (notes.fixed.length > 0) return "Fixes"
  if (notes.improved.length > 0) return "Improvements"
  return "Breaking changes"
}

/** A highlight as a title and body: `**Title**: body`, or else its first clause and the whole text. */
function feature(text: string) {
  const clean = stripCredits(stripPullRequests(text))
  const bold = clean.match(/^\*\*(.+?)\*\*:?\s*(.*)$/)
  if (bold) return { title: plain(bold[1]), body: bold[2] }
  const title = headline(clean, Infinity)!
  return { title, body: plain(clean).replace(/\.$/, "") === title ? "" : clean }
}

/** A note's first clause as a title, when it is short enough to read as one. */
function headline(text: string, max = 100) {
  const first = plain(text)
    .split(/(?<=\.)\s|:\s|;\s|\s—\s|,\s+(?:which|allowing|including|so that)\s/)[0]
    .replace(/\.$/, "")
    .trim()
  if (first.length === 0 || first.length > max) return
  return first
}

/** Text for a title: links become their label, bold markers and credits go. Inline code stays. */
function plain(text: string) {
  return stripPullRequests(text)
    .replace(/\s*Thanks \[@[\w-]+\]\([^)]*\)\.?/g, "")
    .replace(/\s*\(@[\w-]+\)$/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .trim()
}

function stripPullRequests(text: string) {
  return text
    .replace(/\s*\((?:\[#\d+\]\([^)]*\)(?:,\s*)?)+\)/g, "")
    .replace(/\s*\((?:#\d+(?:,\s*)?)+\)/g, "")
    .trim()
}

function pullRequests(text: string) {
  return unique([...text.matchAll(pullRequest)].map((match) => match[1]))
}

/** The GitHub users a note thanks: "Thanks [@a](…) and [@b](…)." (v2) or a trailing "(@a)" (v1). */
function credits(text: string) {
  const thanks = text.match(/Thanks ((?:\[@[\w-]+\]\([^)]*\)(?:,\s*|\s+and\s+)?)+)\.?/)?.[1] ?? ""
  return unique([
    ...[...thanks.matchAll(/\[@([\w-]+)\]/g)].map((match) => match[1]),
    ...[...text.matchAll(/\(@([\w-]+)\)\s*$/g)].map((match) => match[1]),
  ])
}

function stripCredits(text: string) {
  return text
    .replace(/\s*Thanks (?:\[@[\w-]+\]\([^)]*\)(?:,\s*|\s+and\s+)?)+\.?/g, "")
    .replace(/\s*\(@[\w-]+\)\s*$/, "")
    .trim()
}

/**
 * Images and videos in a release body: Markdown and HTML images (with their alt text) and the bare
 * GitHub attachment links that GitHub plays as videos.
 */
function releaseMedia(body: string): ChangelogMedia[] {
  const markdown = [...body.matchAll(/!\[([^\]]*)\]\((https:[^)\s]+)\)/g)].map(
    (match): ChangelogMedia => ({ type: "image", src: match[2], alt: match[1] }),
  )
  const html = [...body.matchAll(/<img\b[^>]*>/g)].flatMap((match): ChangelogMedia[] => {
    const src = match[0].match(/\bsrc="(https:[^"]+)"/)?.[1]
    return src ? [{ type: "image", src, alt: match[0].match(/\balt="([^"]*)"/)?.[1] ?? "" }] : []
  })
  const videos = [...body.matchAll(/^\s*(https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+)\s*$/gm)].map(
    (match): ChangelogMedia => ({ type: "video", src: match[1], alt: "" }),
  )
  return [...markdown, ...html, ...videos]
}

function noteKind(heading: string) {
  if (/fix/i.test(heading)) return "fixed" as const
  if (/^(improvements?|features?|new features?|changes|additions)$/i.test(heading)) return "improved" as const
}

function breakingItem(items: { title: string; lines: string[] }[]) {
  if (items.length === 0) items.push({ title: "", lines: [] })
  return items[items.length - 1]
}

/** Notes with the same pull requests are one change listed under several sections. */
function mergeNotes(notes: { text: string; area: string; prs: string[] }[]) {
  const seen = new Map<string, ChangelogNote>()
  return notes.flatMap((note) => {
    const key = note.prs.join(",")
    const existing = key ? seen.get(key) : undefined
    if (existing) {
      if (!existing.areas.includes(note.area)) existing.areas.push(note.area)
      existing.credits = unique([...existing.credits, ...credits(note.text)])
      return []
    }
    const item = {
      text: stripCredits(stripPullRequests(note.text)),
      areas: note.area ? [note.area] : [],
      prs: note.prs,
      credits: credits(note.text),
    }
    if (key) seen.set(key, item)
    return [item]
  })
}

function onlyAreas(notes: ReleaseNotes, areas: string[]): ReleaseNotes {
  const matches = (item: { areas: string[] }) => item.areas.some((area) => areas.includes(area))
  return {
    media: notes.media,
    features: notes.features.filter(matches),
    breaking: notes.breaking.filter(matches),
    improved: notes.improved.filter(matches),
    fixed: notes.fixed.filter(matches),
  }
}

function noteCount(notes: ReleaseNotes) {
  return notes.features.length + notes.breaking.length + notes.improved.length + notes.fixed.length
}

function tiny(notes: ReleaseNotes) {
  return notes.features.length === 0 && notes.breaking.length === 0 && notes.improved.length + notes.fixed.length <= 3
}

function merge(
  a: { date: string; releases: { tag: string; url: string }[]; notes: ReleaseNotes },
  b: { date: string; releases: { tag: string; url: string }[]; notes: ReleaseNotes },
) {
  return {
    date: a.date,
    releases: [...a.releases, ...b.releases],
    notes: {
      media: [...a.notes.media, ...b.notes.media],
      features: [...a.notes.features, ...b.notes.features],
      breaking: [...a.notes.breaking, ...b.notes.breaking],
      improved: [...a.notes.improved, ...b.notes.improved],
      fixed: [...a.notes.fixed, ...b.notes.fixed],
    },
  }
}

function unique(items: string[]) {
  return [...new Set(items)]
}
