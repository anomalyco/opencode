import { fromPathname, strip, type Locale } from "~/lib/language"
import { docsSets, latestDocs, v1Docs, type DocsSet } from "./config"
import { docsHref, docsLocaleHref, docsMarkdownHref } from "./lib/navigation"

/**
 * What a request under a docs set's base gets, given each set's page slugs (`virtual:docs-pages`, the
 * list the build prerenders): one of the set's own files, a page or its Markdown twin, or a redirect.
 * The latest docs take the site's locale prefix (`/zh/docs/config/`); English has none, and its
 * prefixed address redirects there. The V1 docs never take one: their slugs carry their own
 * languages (/v1/docs/ja/config/).
 *
 * Any /docs path that isn't a page here was a V1 docs page, which may have had another language
 * (/docs/ja/...), so it goes to the same path on the V1 docs, temporarily, because V2 may add the
 * page later. Under a locale prefix the V1 address uses that language too (`/zh/docs/old` →
 * /v1/docs/zh-cn/old). Undefined outside the docs.
 */
export function docsRoute(url: URL, accept: string, slugs: Record<DocsSet["id"], readonly string[]>) {
  const locale = fromPathname(url.pathname)
  const pathname = locale ? strip(url.pathname) : url.pathname
  const set = docsSets.find((set) => `${pathname.replace(/\.md$/, "")}/`.startsWith(set.base))
  if (!set) return
  // The V1 docs keep their own addresses: a locale prefix belongs to the site, not to them
  // (middleware.ts strips it and redirects).
  if (locale && set.id !== "latest") return
  // English has no prefix: /en/docs/... is the same page at /docs/....
  if (locale === "en") return redirect(`${pathname}${url.search}`, 301)
  const pageLocale: Locale = locale ?? "en"

  // Agents try a page's URL plus .md first, which for the intro is /docs.md.
  const path =
    pathname === `${set.base.slice(0, -1)}.md`
      ? `${set.base}index.md`.slice(set.base.length - 1)
      : pathname.slice(set.base.length - 1)
  if (set.files.includes(path.split("/")[1] ?? "")) return { type: "file" as const, set, path }

  const file = path.endsWith(".md")
  const page = file ? path.slice(0, -3) : path
  const slug = page.replace(/^\/|\/$/g, "") || "index"
  if (set.id === "v1" && !slugs.v1.includes(slug)) return v1Fallback(slug, file, url.search)
  const target = moved.get(slug)
  if (target) return redirect(docsLocaleHref(target, latestDocs, pageLocale), 301)
  if (!slugs[set.id].includes(slug))
    return redirect(v1Address(pageLocale, slug, file, path.endsWith("/"), url.search), 302)
  const canonical = docsLocaleHref(slug, set, pageLocale)
  if (!file && path.endsWith("/") && !canonical.endsWith("/")) return redirect(canonical, 307)
  // The API reference has no Markdown twin.
  const twin = slug !== "api"
  const markdown = file || (twin && (accept.includes("text/markdown") || accept.includes("text/x-markdown")))
  if (markdown && !twin) return { type: "missing" as const }
  return { type: "page" as const, set, slug, locale: pageLocale, markdown, twin }
}

// The latest docs' languages in the V1 docs' folders, where their names differ.
const v1Locales: Partial<Record<Locale, string>> = { zh: "zh-cn", zht: "zh-tw", br: "pt-br", no: "nb" }

/** A missing page's address on the V1 docs, in the same language when they have it. */
function v1Address(locale: Locale, slug: string, file: boolean, slash: boolean, search: string) {
  const language = v1Locales[locale] ?? (v1Docs.locales!.includes(locale) ? locale : undefined)
  const path = `${v1Docs.base}${language ? `${language}/` : ""}${slug}`
  return `${path}${file ? ".md" : slash ? "/" : ""}${search}`
}

/**
 * docs.opencode.ai (and docs.dev.opencode.ai) served the V1 docs from their own app, under /docs and
 * at its root: every address there is the same path under /docs here, permanently, which takes it to
 * its V2 page or on to the V1 docs as for any other /docs path.
 */
export function docsHostRedirect(url: URL) {
  if (!url.hostname.startsWith("docs.")) return
  const path = url.pathname.replace(/^\/docs(?=\/|$)/, "") || "/"
  return `https://${url.hostname.slice("docs.".length)}${latestDocs.base.slice(0, -1)}${path}${url.search}`
}

// Pages that moved, by slug: V2's own move, V1's Go and Zen pages, which became Console pages, and
// V1 pages whose V2 page has another address.
const moved = new Map([
  ["console/inference", "console/api/inference"],
  ["go", "console/go"],
  ["zen", "console/models"],
  ["rules", "instructions"],
  ["sdk", "build/sdk"],
  ["server", "api"],
  ["keybinds", "cli/keybinds"],
  ["tui", "cli/tui"],
  ["web", "cli/web"],
  ["acp", "cli/acp"],
  ["modes", "agents"],
  ["custom-tools", "build/plugins/server"],
])

// The V1 docs app's other names for its languages (its middleware), and English's.
const aliases: Record<string, string> = {
  en: "",
  root: "",
  uk: "",
  zh: "zh-cn",
  zht: "zh-tw",
  br: "pt-br",
  pt: "pt-br",
  no: "nb",
  nn: "nb",
}

/** A V1 address that isn't a page, as the V1 docs app answered it, or missing. */
function v1Fallback(slug: string, file: boolean, search: string) {
  const [first, ...rest] = slug.split("/")
  const named = first.toLowerCase()
  const locale = aliases[named] ?? (v1Docs.locales!.includes(named) ? named : undefined)
  const page = locale === undefined ? slug : rest.join("/") || "index"
  const href = (slug: string) => `${file ? docsMarkdownHref(slug, v1Docs) : docsHref(slug, v1Docs)}${search}`
  if (locale !== undefined && locale !== first) return redirect(href(locale ? `${locale}/${page}` : page), 301)
  const target = moved.get(page)
  if (target) return redirect(docsHref(target, latestDocs), 301)
  // Share links (docs.opencode.ai/s/<id>). Sharing is discontinued; opncd.ai explains it (lib/legacy.ts).
  if (first === "s" && rest.length === 1) return redirect(`https://opncd.ai/share/${rest[0]}`, 301)
  // The config schemas the V1 app served beside its pages are the site's.
  if (slug === "config.json" || slug === "tui.json") return redirect(`/${slug}`, 301)
  return { type: "missing" as const }
}

function redirect(location: string, status: number) {
  return { type: "redirect" as const, location, status }
}
