import { latestDocs, v1Docs } from "../config"
import type { Locale } from "~/lib/language"
import { docsHref, type DocsSection } from "./navigation"

/**
 * The V1 docs' languages, as their Starlight app had them (packages/web/astro.config.mjs): the folder
 * and the name, with `<html lang>` and the site's strings for the shell (src/i18n) where they aren't
 * the folder's name. Bosnian has no site strings, so its shell is English.
 */
export const v1Locales: V1Locale[] = [
  { path: "", label: "English" },
  { path: "ar", label: "العربية" },
  { path: "bs", label: "Bosanski", site: "en" },
  { path: "da", label: "Dansk" },
  { path: "de", label: "Deutsch" },
  { path: "es", label: "Español" },
  { path: "fr", label: "Français" },
  { path: "it", label: "Italiano" },
  { path: "ja", label: "日本語" },
  { path: "ko", label: "한국어" },
  { path: "nb", label: "Norsk Bokmål", site: "no" },
  { path: "pl", label: "Polski" },
  { path: "pt-br", label: "Português (Brasil)", lang: "pt-BR", site: "br" },
  { path: "ru", label: "Русский" },
  { path: "th", label: "ไทย" },
  { path: "tr", label: "Türkçe" },
  { path: "zh-cn", label: "简体中文", lang: "zh-Hans", site: "zh" },
  { path: "zh-tw", label: "繁體中文", lang: "zh-Hant", site: "zht" },
]

export type V1Locale = { path: string; label: string; lang?: string; site?: Locale }

// The sidebar's group titles in each language (Usage, Configure, Develop), from the Starlight config.
const groupTitles: Record<string, readonly string[]> = {
  "": ["Usage", "Configure", "Develop"],
  ar: ["الاستخدام", "الإعداد", "التطوير"],
  bs: ["Korištenje", "Podešavanje", "Razvoj"],
  da: ["Brug", "Konfiguration", "Udvikling"],
  de: ["Nutzung", "Konfiguration", "Entwicklung"],
  es: ["Uso", "Configuración", "Desarrollo"],
  fr: ["Utilisation", "Configuration", "Développement"],
  it: ["Utilizzo", "Configurazione", "Sviluppo"],
  ja: ["使い方", "設定", "開発"],
  ko: ["사용", "구성", "개발"],
  nb: ["Bruk", "Konfigurasjon", "Utvikling"],
  pl: ["Użycie", "Konfiguracja", "Rozwój"],
  "pt-br": ["Uso", "Configuração", "Desenvolvimento"],
  ru: ["Использование", "Настройка", "Разработка"],
  th: ["การใช้งาน", "การกำหนดค่า", "การพัฒนา"],
  tr: ["Kullanım", "Yapılandırma", "Geliştirme"],
  "zh-cn": ["使用", "配置", "开发"],
  "zh-tw": ["使用", "設定", "開發"],
}

/** The callouts' labels (note, tip, caution) in each language, as Starlight translated them. English and Bosnian use the site's. */
export const asideTitles: Record<string, readonly string[]> = {
  ar: ["ملاحظة", "نصيحة", "تنبيه"],
  da: ["Note", "Tip", "Bemærk"],
  de: ["Hinweis", "Tipp", "Achtung"],
  es: ["Nota", "Consejo", "Precaución"],
  fr: ["Note", "Astuce", "Attention"],
  it: ["Nota", "Consiglio", "Attenzione"],
  ja: ["ノート", "ヒント", "注意"],
  ko: ["참고", "팁", "주의"],
  nb: ["Merknad", "Tips", "Advarsel"],
  pl: ["Notatka", "Wskazówka", "Uwaga"],
  "pt-br": ["Nota", "Dica", "Cuidado"],
  ru: ["Заметка", "Совет", "Осторожно"],
  th: ["หมายเหตุ", "เคล็ดลับ", "คำเตือน"],
  tr: ["Not", "İpucu", "Dikkat"],
  "zh-cn": ["注意", "提示", "警告"],
  "zh-tw": ["注意", "提示", "警告"],
}

/** A V1 page's language, from its slug's first segment (`ja/config`), and its slug in English (`config`). */
export function v1Page(slug: string) {
  const [first, ...rest] = slug.split("/")
  const locale = v1Locales.find((locale) => locale.path && locale.path === first)
  if (!locale) return { locale: v1Locales[0], page: slug }
  return { locale, page: rest.join("/") || "index" }
}

/** A V1 page in a language: `ja/config`, or `config` in English. */
export function v1Slug(locale: V1Locale, page: string) {
  if (!locale.path) return page
  return page === "index" ? locale.path : `${locale.path}/${page}`
}

// The sidebar's pages in order, by their English slug. Go and the Console were V1 pages that are
// Console pages in the latest docs.
const groups = [
  "index config providers network enterprise troubleshooting windows-wsl",
  "go tui cli web ide console github gitlab",
  "tools rules agents models themes keybinds commands formatters permissions policies lsp mcp-servers acp skills references custom-tools",
  "sdk server plugins ecosystem",
].map((pages) => pages.split(" "))
const named: Record<string, { title: string; href?: string }> = {
  "windows-wsl": { title: "Windows" },
  go: { title: "Go", href: docsHref("console/go", latestDocs) },
  console: { title: "Console", href: docsHref("console", latestDocs) },
}

/**
 * The V1 docs' one section in a language: its pages named by their titles there (`titles`, by English
 * slug), as Starlight named them. Pages it doesn't have (policies, references) stay in English only.
 */
export function v1Section(locale: V1Locale, titles: Map<string, string>): DocsSection {
  return {
    key: "docs",
    title: "Docs",
    landingSlug: v1Slug(locale, "index"),
    groups: groups.map((pages, index) => ({
      title: index ? groupTitles[locale.path][index - 1] : undefined,
      items: pages.flatMap((page) => {
        const title = named[page]?.title ?? titles.get(page)
        if (!title) return []
        return [{ title, slug: v1Slug(locale, page), href: named[page]?.href }]
      }),
    })),
  }
}

// V1 pages at another address in the latest docs.
const renamed: Record<string, string> = {
  acp: "cli/acp",
  keybinds: "cli/keybinds",
  tui: "cli/tui",
  web: "cli/web",
  sdk: "build/sdk",
  rules: "instructions",
}

/**
 * The latest docs' version of a V1 page (its English slug), or their intro when they have none: a
 * missing /docs page goes back to V1 (route.ts), so linking it would loop.
 */
export function latestHref(page: string, latestSlugs: readonly string[]) {
  const slug = renamed[page] ?? page
  return latestSlugs.includes(slug) ? docsHref(slug, latestDocs) : latestDocs.base
}

/** The V1 version of a latest docs page, or the V1 intro when it has none. */
export function v1Href(slug: string, v1Slugs: readonly string[]) {
  const page = Object.keys(renamed).find((page) => renamed[page] === slug) ?? slug
  return v1Slugs.includes(page) ? docsHref(page, v1Docs) : v1Docs.base
}
