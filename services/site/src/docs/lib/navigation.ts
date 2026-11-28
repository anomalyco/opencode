// Relative, not ~: vite.config.ts imports this module before the site's aliases exist.
import { LOCALES, type Locale } from "../../lib/language"
import type { DocsSet } from "../config"

export interface DocsNavItem {
  title: string
  slug: string
  /** A page in another docs set (the V1 docs' Go and Console pages are in the latest docs). */
  href?: string
}

/**
 * A section or group label that is UI copy rather than a page title: the sidebar reads it from the
 * page language's dictionary, while page titles come from the pages themselves.
 */
export type DocsNavLabel =
  | "nav.docs"
  | "docs.section.build"
  | "docs.nav.configure"
  | "docs.nav.plugins"
  | "docs.nav.client"
  | "docs.nav.workspace"
  | "docs.nav.console"

export interface DocsNavGroup {
  title?: string
  titleKey?: DocsNavLabel
  items: DocsNavItem[]
}

export interface DocsSection {
  key: "docs" | "cli" | "build" | "api" | "console"
  title: string
  titleKey?: DocsNavLabel
  landingSlug: string
  groups: DocsNavGroup[]
}

export const docsSections: DocsSection[] = [
  {
    key: "docs",
    title: "Docs",
    titleKey: "nav.docs",
    landingSlug: "index",
    groups: [
      {
        items: [
          { title: "Intro", slug: "index" },
          { title: "Config", slug: "config" },
          { title: "Migrate from V1", slug: "migrate-v1" },
          { title: "Enterprise", slug: "enterprise" },
          { title: "Troubleshooting", slug: "troubleshooting" },
        ],
      },
      {
        title: "Configure",
        titleKey: "docs.nav.configure",
        items: [
          { title: "Agents", slug: "agents" },
          { title: "Models", slug: "models" },
          { title: "Skills", slug: "skills" },
          { title: "Themes", slug: "themes" },
          { title: "Commands", slug: "commands" },
          { title: "Plugins", slug: "plugins" },
          { title: "Providers", slug: "providers" },
          { title: "Web search", slug: "websearch" },
          { title: "Network", slug: "network" },
          { title: "Snapshots", slug: "snapshots" },
          { title: "Compaction", slug: "compaction" },
          { title: "Formatters", slug: "formatters" },
          { title: "References", slug: "references" },
          { title: "Attachments", slug: "attachments" },
          { title: "Tools", slug: "tools" },
          { title: "MCP servers", slug: "mcp-servers" },
          { title: "Permissions", slug: "permissions" },
          { title: "Policies", slug: "policies" },
          { title: "Instructions", slug: "instructions" },
          { title: "Warming", slug: "warming" },
        ],
      },
    ],
  },
  {
    key: "cli",
    title: "CLI",
    landingSlug: "cli",
    groups: [
      {
        items: [
          { title: "Intro", slug: "cli" },
          { title: "TUI", slug: "cli/tui" },
          { title: "Settings", slug: "cli/config" },
          { title: "Web", slug: "cli/web" },
          { title: "Providers", slug: "cli/providers" },
          { title: "Commands", slug: "cli/commands" },
          { title: "ACP", slug: "cli/acp" },
          { title: "Theme", slug: "cli/theme" },
          { title: "Plugins", slug: "cli/plugins" },
          { title: "Keybinds", slug: "cli/keybinds" },
        ],
      },
    ],
  },
  {
    key: "build",
    title: "Build",
    titleKey: "docs.section.build",
    landingSlug: "build",
    groups: [
      {
        items: [{ title: "Intro", slug: "build" }],
      },
      {
        title: "Plugins",
        titleKey: "docs.nav.plugins",
        items: [
          { title: "Overview", slug: "build/plugins" },
          { title: "Server", slug: "build/plugins/server" },
          { title: "TUI", slug: "build/plugins/cli" },
          { title: "GUI", slug: "build/plugins/gui" },
          { title: "RPC", slug: "build/plugins/rpc" },
          { title: "Migrate from V1", slug: "build/plugins/migrate-v1" },
        ],
      },
      {
        title: "Client",
        titleKey: "docs.nav.client",
        items: [{ title: "JavaScript", slug: "build/client" }],
      },
      {
        title: "SDK",
        items: [
          { title: "Overview", slug: "build/sdk" },
          { title: "Cloudflare", slug: "build/sdk/cloudflare" },
        ],
      },
      {
        title: "Effect",
        items: [
          { title: "Plugins", slug: "build/plugins/effect" },
          { title: "RPC", slug: "build/plugins/effect/rpc" },
          { title: "Client", slug: "build/client/effect" },
          { title: "SDK", slug: "build/sdk/effect" },
        ],
      },
    ],
  },
  {
    key: "api",
    title: "API",
    landingSlug: "api",
    groups: [
      {
        title: "API",
        items: [{ title: "Overview", slug: "api" }],
      },
    ],
  },
  {
    key: "console",
    title: "Console",
    titleKey: "docs.nav.console",
    landingSlug: "console",
    groups: [
      {
        items: [
          { title: "Intro", slug: "console" },
          { title: "Models", slug: "console/models" },
          { title: "Providers", slug: "console/providers" },
          { title: "Web search", slug: "console/websearch" },
          { title: "Watches", slug: "console/watches" },
          { title: "Go", slug: "console/go" },
        ],
      },
      {
        title: "Workspace",
        titleKey: "docs.nav.workspace",
        items: [
          { title: "Basics", slug: "console/workspaces" },
          { title: "Members", slug: "console/members" },
          { title: "SSO", slug: "console/sso" },
          { title: "SCIM", slug: "console/scim" },
          { title: "Budgets", slug: "console/budgets" },
          { title: "Billing", slug: "console/billing" },
        ],
      },
      {
        title: "API",
        items: [
          { title: "Overview", slug: "console/api" },
          { title: "Models", slug: "console/api/models" },
          { title: "Inference", slug: "console/api/inference" },
          { title: "Providers", slug: "console/api/providers" },
          { title: "Usage export", slug: "console/api/usage-export" },
        ],
      },
      {
        title: "Harnesses",
        items: [
          { title: "Overview", slug: "console/harnesses" },
          { title: "Claude Code", slug: "console/harnesses/claude-code" },
          { title: "Codex", slug: "console/harnesses/codex" },
          { title: "Hermes", slug: "console/harnesses/hermes" },
          { title: "OpenClaw", slug: "console/harnesses/openclaw" },
          { title: "Pi", slug: "console/harnesses/pi" },
          { title: "Raycast", slug: "console/harnesses/raycast" },
        ],
      },
    ],
  },
]

// Pages whose URL has no trailing slash. The slash form redirects to them (middleware.ts).
const assetSlugs = new Set(["api"])

export function docsHref(slug: string, set: DocsSet) {
  const path = slug === "index" ? "" : `${slug.replace(/\/index$/, "")}${assetSlugs.has(slug) ? "" : "/"}`
  return `${set.base}${path}`
}

/**
 * The Markdown twin of a docs page: its URL without the trailing slash, plus `.md`. The intro's is
 * `/docs/index.md`, so it stays under the docs' prefix (middleware.ts also answers `/docs.md`).
 */
export function docsMarkdownHref(slug: string, set: DocsSet) {
  return slug === "index" ? `${set.base}index.md` : `${docsHref(slug, set).replace(/\/$/, "")}.md`
}

/** A page's URL in one of the latest docs' languages: English keeps the set's base, the rest take `/<locale>`. */
export function docsLocaleBase(locale: Locale, set: DocsSet) {
  return locale === "en" ? set.base : `/${locale}${set.base}`
}

/** A page's URL in a language, for its language alternates and the language picker. */
export function docsLocaleHref(slug: string, set: DocsSet, locale: Locale) {
  return locale === "en" ? docsHref(slug, set) : `/${locale}${docsHref(slug, set)}`
}

/** A page's Markdown twin in a language. */
export function docsLocaleMarkdownHref(slug: string, set: DocsSet, locale: Locale) {
  return locale === "en" ? docsMarkdownHref(slug, set) : `/${locale}${docsMarkdownHref(slug, set)}`
}

/** The search index a page loads: each language has its own, beside its pages (script/build.ts). */
export function docsPagefindHref(set: DocsSet, locale: Locale) {
  return `${docsLocaleBase(locale, set)}pagefind/pagefind.js`
}

/**
 * The languages a page is available in: English always, plus the languages it has a current
 * translation in, in the site's order. A page's head and the sitemap both use this, so they list
 * the same set (the page itself included).
 */
export function docsLanguageAlternates(translated: readonly Locale[]) {
  return LOCALES.filter((locale) => locale === "en" || translated.includes(locale))
}

/** The languages a page is available in, by its translated languages. */
export function docsAlternates(slug: string, translated: ReadonlyMap<string, readonly Locale[]>) {
  return docsLanguageAlternates(translated.get(slug) ?? [])
}

/**
 * A page's canonical URL: its own address when it is translated (or English), and the English page's
 * when that language only has the fallback (translated pages reuse the English page's headings, so the
 * fallback is the same content in another chrome). Its hreflang alternates list only the languages
 * with a translation, so a fallback page never competes with the English one.
 */
export function docsCanonicalHref(slug: string, set: DocsSet, locale: Locale, translated: boolean) {
  if (locale === "en" || translated) return docsLocaleHref(slug, set, locale)
  return docsHref(slug, set)
}

/**
 * Where a file under the latest docs' `content/` is: its translated language and English slug, or
 * undefined for an English page. Translations live in `content/<locale>/<same path>.mdx`.
 */
export function docsTranslation(file: string) {
  const [first, ...rest] = file.split("/")
  if (!rest.length || !(LOCALES as readonly string[]).includes(first)) return
  return { locale: first as Locale, slug: docsSlug(rest.join("/")) }
}

/** A content file's slug: its path under content/ without `.mdx` or a trailing `/index`. */
export function docsSlug(file: string) {
  const slug = file.replace(/\.mdx$/, "")
  return slug === "index" ? slug : slug.replace(/\/index$/, "")
}

export function getDocsSection(slug: string) {
  return (
    docsSections.find((section) => section.groups.some((group) => group.items.some((item) => item.slug === slug))) ??
    docsSections[0]
  )
}

/**
 * A section in a page's language: its UI labels from the dictionary (`docs.nav.*`) and its page
 * titles from `titles`, a translated page's own frontmatter title by slug. A page without a current
 * translation has no entry, so the English navigation title stays (as do pages in another set).
 */
export function docsSectionTitles(
  section: DocsSection,
  titles: ReadonlyMap<string, string>,
  label: (key: DocsNavLabel) => string,
): DocsSection {
  return {
    ...section,
    title: section.titleKey ? label(section.titleKey) : section.title,
    groups: section.groups.map((group) => ({
      ...group,
      title: group.titleKey ? label(group.titleKey) : group.title,
      items: group.items.map((item) => ({ ...item, title: titles.get(item.slug) ?? item.title })),
    })),
  }
}
