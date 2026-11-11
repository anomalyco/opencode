// Checks a locale's translations against the English: the UI dictionary (src/i18n/<locale>.ts) and
// the page copy (src/i18n/content/<locale>.ts). Run it from services/site:
//
//   bun src/i18n/check.ts [locale ...] [--stamp]
//
// Errors (exit 1, and test/i18n.test.ts fails): a dictionary key the English doesn't have, and a
// translation whose {{params}}, [text](link) ids or `code` spans differ from the English.
// Warnings: entries still in English that were never reviewed, entries whose English changed since
// they were translated, and page copy the English no longer has (an item whose English title
// changed, for example), which no page shows. A stamp (src/i18n/stamps/<locale>.json) records a hash of the English
// each entry was translated from; --stamp records the current English for every translated entry,
// so run it once everything the check lists is translated.
import path from "node:path"
import { dict as en } from "~/i18n/en"
import { LOCALES, type Locale } from "~/lib/language"
import { interpolate } from "~/i18n"
import { contentSource } from "~/i18n/content/source"
import { itemIds, keyedList, structural, structuralPaths, structuralStrings } from "~/i18n/content/paths"

type Report = {
  locale: Locale
  errors: string[]
  untranslated: string[]
  stale: string[]
  unused: string[]
  stamps: Record<string, string>
}

const stampDir = path.join(import.meta.dir, "stamps")

/** Every check for one locale. `stamps` is what --stamp would write. */
export async function checkLocale(locale: Exclude<Locale, "en">): Promise<Report> {
  const dict: Record<string, string> = (await import(`./${locale}.ts`)).dict
  const content: unknown = (await import(`./content/${locale}.ts`)).content
  const file = Bun.file(path.join(stampDir, `${locale}.json`))
  const stamps: Record<string, string> = (await file.exists()) ? await file.json() : {}
  const report: Report = { locale, errors: [], untranslated: [], stale: [], unused: [], stamps: {} }

  const english = en as Record<string, string>
  Object.keys(dict)
    .filter((key) => !(key in english))
    .forEach((key) => report.errors.push(`${key}: not in the English dictionary`))
  const entries = [
    ...Object.keys(english).map((key) => ({ id: key, english: english[key], value: dict[key] })),
    ...contentEntries(contentSource((key, params) => interpolate(english[key], params)), content, "", report.unused).map((entry) => ({ ...entry, id: `content:${entry.id}` })),
  ]
  for (const entry of entries) {
    const hash = Bun.hash(entry.english).toString(36)
    const translated = entry.value !== undefined && entry.value !== "" && entry.value !== entry.english
    if (translated) report.errors.push(...mismatches(entry.id, entry.english, entry.value!))
    if (translated || stamps[entry.id]) report.stamps[entry.id] = translated ? hash : stamps[entry.id]
    if (!translated && !stamps[entry.id]) report.untranslated.push(entry.id)
    if (stamps[entry.id] && stamps[entry.id] !== hash) report.stale.push(entry.id)
  }
  return report
}

/** The parts of a string a translation must keep exactly: params, link ids and code spans. */
export function tokens(text: string) {
  return {
    params: [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).toSorted(),
    links: [...text.matchAll(/\]\((\w+)\)/g)].map((match) => match[1]).toSorted(),
    code: [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]).toSorted(),
  }
}

function mismatches(id: string, english: string, value: string) {
  const want = tokens(english)
  const have = tokens(value)
  return (["params", "links", "code"] as const)
    .filter((kind) => want[kind].join("\n") !== have[kind].join("\n"))
    .map((kind) => `${id}: ${kind} ${JSON.stringify(have[kind])}, the English has ${JSON.stringify(want[kind])}`)
}

/**
 * The translatable English strings of the page copy with the locale's value at the same place, by the
 * path content/index.ts merges on (keyed list items by item id). Entries the English doesn't have go
 * to `unused`.
 */
function contentEntries(base: unknown, overlay: unknown, at: string, unused: string[]): { id: string; english: string; value?: string }[] {
  if (typeof base === "string") {
    if (structuralPaths.some((pattern) => matches(pattern, at))) return []
    return [{ id: at, english: base, value: typeof overlay === "string" ? overlay : undefined }]
  }
  const join = (key: string) => (at ? `${at}.${key}` : key)
  if (Array.isArray(base)) {
    const list: readonly unknown[] = base
    if (keyedList(list)) {
      const ids = itemIds(list)
      const items = (isRecord(overlay) ? overlay : {}) as Record<string, unknown>
      Object.keys(items)
        .filter((id) => !ids.includes(id))
        .forEach((id) => unused.push(`content:${join(id)}`))
      return list.flatMap((item, index) => contentEntries(item, items[ids[index]], join(ids[index]), unused))
    }
    const items = Array.isArray(overlay) ? overlay : []
    items.slice(list.length).forEach((_, index) => unused.push(`content:${join(String(list.length + index))}`))
    return list.flatMap((item, index) => contentEntries(item, items[index], join(String(index)), unused))
  }
  if (!isRecord(base)) return []
  const values = (isRecord(overlay) ? overlay : {}) as Record<string, unknown>
  const fields = Object.keys(base).filter(
    (key) =>
      !(structural as readonly string[]).includes(key) &&
      !((structuralStrings as readonly string[]).includes(key) && typeof base[key] === "string"),
  )
  Object.keys(values)
    .filter((key) => !fields.includes(key))
    .forEach((key) => unused.push(`content:${join(key)}`))
  return fields.flatMap((key) => contentEntries(base[key], values[key], join(key), unused))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function matches(pattern: string, at: string) {
  const want = pattern.split(".")
  const have = at.split(".")
  return want.length === have.length && want.every((part, index) => part === "*" || part === have[index])
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const stamp = args.includes("--stamp")
  const asked = args.filter((arg) => !arg.startsWith("--"))
  const unknown = asked.filter((arg) => !(LOCALES as readonly string[]).includes(arg) || arg === "en")
  if (unknown.length) {
    console.error(`unknown locale ${unknown.join(", ")}; use one of ${LOCALES.slice(1).join(" ")}`)
    process.exit(2)
  }
  const locales = (asked.length ? asked : LOCALES.slice(1)) as Exclude<Locale, "en">[]
  const reports = await Promise.all(locales.map(checkLocale))
  for (const report of reports) {
    console.log(
      `${report.locale}: ${report.errors.length} errors, ${report.untranslated.length} untranslated, ${report.stale.length} changed in English, ${report.unused.length} unused`,
    )
    report.errors.forEach((line) => console.log(`  error  ${line}`))
    if (asked.length) {
      report.untranslated.forEach((id) => console.log(`  todo   ${id} (untranslated)`))
      report.stale.forEach((id) => console.log(`  todo   ${id} (English changed)`))
      report.unused.forEach((id) => console.log(`  unused ${id} (no English to translate)`))
    }
    if (stamp && !report.errors.length)
      await Bun.write(path.join(stampDir, `${report.locale}.json`), `${JSON.stringify(sortKeys(report.stamps), null, 2)}\n`)
  }
  if (reports.some((report) => report.errors.length)) process.exit(1)
}

function sortKeys(record: Record<string, string>) {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
