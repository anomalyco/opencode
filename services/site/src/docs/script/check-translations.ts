// Checks the latest docs' translations against their English pages, as src/i18n/check.ts does for
// the site's strings: which pages a language has translated, which English pages it is missing,
// which translations the English has changed since (a stamp records the English a translation was
// made from), and translations whose English page is gone. Run it from services/site:
//
//   bun src/docs/script/check-translations.ts [locale ...] [--stamp]
//
// Stamps live in src/docs/i18n/stamps/<locale>.json, by English slug. --stamp records the current
// English for every translated page, so run it once a language's translations are up to date.
import { readdirSync } from "node:fs"
import path from "node:path"
import type { Locale } from "~/lib/language"
import { latestDocsLocales } from "../config"
import { docsSlug, docsTranslation } from "../lib/navigation"

const content = path.resolve(import.meta.dir, "../content")
const stampDir = path.resolve(import.meta.dir, "../i18n/stamps")
const english = new Map(
  readdirSync(content, { recursive: true, encoding: "utf8" })
    .map(slash)
    .filter((file) => file.endsWith(".mdx") && !docsTranslation(file))
    .map((file) => [docsSlug(file), path.join(content, file)]),
)

type Report = {
  locale: Exclude<Locale, "en">
  translated: string[]
  untranslated: string[]
  stale: string[]
  unstamped: string[]
  orphans: string[]
  stamps: Record<string, string>
}

async function checkLocale(locale: Exclude<Locale, "en">): Promise<Report> {
  const files = readdirSync(path.join(content, locale), { recursive: true, encoding: "utf8" })
    .map(slash)
    .filter((file) => file.endsWith(".mdx"))
  const stampsFile = path.join(stampDir, `${locale}.json`)
  const stamps: Record<string, string> = (await Bun.file(stampsFile).exists()) ? await Bun.file(stampsFile).json() : {}
  const report: Report = {
    locale,
    translated: [],
    untranslated: [],
    stale: [],
    unstamped: [],
    orphans: [],
    stamps: {},
  }
  for (const file of files) {
    const slug = docsSlug(file)
    const source = english.get(slug)
    if (!source) {
      report.orphans.push(slug)
      continue
    }
    report.translated.push(slug)
    const hash = Bun.hash(await Bun.file(source).text()).toString(36)
    report.stamps[slug] = hash
    if (!stamps[slug]) report.unstamped.push(slug)
    else if (stamps[slug] !== hash) report.stale.push(slug)
  }
  report.untranslated = [...english.keys()].filter((slug) => !report.translated.includes(slug))
  return report
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const stamp = args.includes("--stamp")
  const asked = args.filter((arg) => !arg.startsWith("--"))
  const unknown = asked.filter(
    (locale) => locale === "en" || !(latestDocsLocales as readonly string[]).includes(locale),
  )
  if (unknown.length) {
    console.error(`unknown locale ${unknown.join(", ")}; use one of ${latestDocsLocales.slice(1).join(" ")}`)
    process.exit(2)
  }
  const locales = (asked.length ? asked : latestDocsLocales.filter((locale) => locale !== "en")) as Exclude<
    Locale,
    "en"
  >[]
  const reports = await Promise.all(locales.map(checkLocale))
  for (const report of reports) {
    console.log(
      `${report.locale}: ${report.translated.length} translated, ${report.untranslated.length} untranslated, ${report.stale.length} changed in English, ${report.unstamped.length} without a stamp, ${report.orphans.length} orphans`,
    )
    if (asked.length) {
      report.untranslated.forEach((slug) => console.log(`  todo     ${slug} (untranslated)`))
      report.stale.forEach((slug) => console.log(`  todo     ${slug} (English changed)`))
      report.unstamped.forEach((slug) => console.log(`  todo     ${slug} (no stamp)`))
      report.orphans.forEach((slug) => console.log(`  orphan   ${slug} (no English page)`))
    }
    if (stamp)
      await Bun.write(
        path.join(stampDir, `${report.locale}.json`),
        `${JSON.stringify(sortKeys(report.stamps), null, 2)}\n`,
      )
  }
}

function slash(file: string) {
  return file.replaceAll("\\", "/")
}

function sortKeys(record: Record<string, string>) {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
