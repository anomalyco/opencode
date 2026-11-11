// What the funnel tracker (lib/funnel.ts) needs to know about the site and the docs, loaded with it. Surfaces and
// targets are analytics keys: rename one only together with the reports that read it.
import { fromPathname, LOCALES, strip, tag } from "./language"

// Pages named by their first segment, as `www-<segment>`.
const pages = new Set([
  "product",
  "desktop",
  "terminal",
  "mobile",
  "sdk",
  "ide",
  "mini",
  "extensions",
  "changelog",
  "brand",
  "press",
  "font",
  "legal",
])
// Development tools, which report nothing.
const tools = new Set(["dev", "devices", "video-editor"])
// Stores and marketplaces, by host, and what a link to one downloads.
const stores: Record<string, string> = {
  "apps.apple.com": "mobile",
  "testflight.apple.com": "mobile",
  "play.google.com": "mobile",
  "marketplace.visualstudio.com": "ide",
  "open-vsx.org": "ide",
  "plugins.jetbrains.com": "ide",
}

/** The config `start` of `/console/funnel/v1.js` takes for this site's and the docs' pages. */
export function funnelConfig() {
  const stamp = Object.values(
    import.meta.glob<{ default: { commit?: string; build?: string } }>("./build-stamp.json", { eager: true }),
  )[0]?.default
  return {
    surfaceOf,
    targetOf,
    normalizePath: strip,
    localeOf,
    // The site is at the host's root, so every page on the host is `link:`; the Console's are calls to action.
    base: "",
    downloadOf,
    build: stamp?.build ?? stamp?.commit ?? "dev",
  }
}

/** A page's surface by its path without the locale (`www-home`, `www-docs`), or undefined for a development tool. */
export function surfaceOf(path: string) {
  // Browse is a product page but keeps its own surface, as it had at /browse.
  if (path === "/product/browse") return "www-browse"
  const parts = path.split("/")
  if (path === "/") return "www-home"
  if (parts[1] === "docs" || /^\/v1\/docs(\/|$)/.test(path)) return "www-docs"
  if (tools.has(parts[1])) return undefined
  return pages.has(parts[1]) ? `www-${parts[1]}` : "www-other"
}

/** What a view targets: the docs' section (`v1` for the V1 docs), the extension, the release or the legal document; `""` for the rest. */
export function targetOf(path: string) {
  if (/^\/v1\/docs(\/|$)/.test(path)) return "v1"
  const parts = path.split("/").filter((part) => part !== "")
  const part = parts[0] === "docs" || pages.has(parts[0]) ? parts[1] : undefined
  return (part ?? "").replace(/[^A-Za-z0-9_.:+-]+/g, "-").slice(0, 96)
}

/** The page's language: its address's prefix, else the one it's shown in (`<html lang>`), else English. */
export function localeOf(path: string) {
  return fromPathname(path) ?? LOCALES.find((locale) => tag(locale) === document.documentElement.lang) ?? "en"
}

/**
 * A download link's target and details: the update API's desktop and CLI builds (`desktop`, `cli`) with their file,
 * channel and whether they're for the visitor's system, and the app stores and editor marketplaces (`mobile`, `ide`).
 */
export function downloadOf(link: URL) {
  const build = /^\/update\/api\/([a-z0-9-]+)\/(desktop|cli)\/opencode\/([A-Za-z0-9_.-]+)$/.exec(link.pathname)
  // Always production's: there is one release service (lib/download.ts).
  if (build && link.hostname === "opencode.ai")
    return {
      target: build[2],
      properties: { file: build[3], channel: build[1], os_match: systemOf(build[3]) === systemOf(visitorSystem()) },
    }
  const store = stores[link.hostname]
  if (store) return { target: store, properties: { file: link.hostname } }
}

const systemOf = (text: string) => {
  const value = text.toLowerCase()
  if (/iphone|ipad|android/.test(value)) return "mobile"
  if (/mac|darwin/.test(value)) return "macos"
  if (/win/.test(value)) return "windows"
  if (/linux|x11|cros/.test(value)) return "linux"
  return "other"
}

const visitorSystem = () =>
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.userAgent
