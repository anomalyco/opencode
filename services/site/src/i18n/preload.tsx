import { useCurrentMatches } from "@solidjs/router"
import { isServer, ssr, useAssets } from "solid-js/web"
import preloads from "virtual:i18n-preload"
import { useLanguage } from "~/context/language"

/**
 * Server only: preloads the page's strings in its language (the locale's table, the shell's slice
 * and the page route's), so they arrive with the page's scripts rather than after them. Written like
 * Vite's own preloads, so lib/one-stylesheet.ts gives them the same priority. The client build writes
 * where each file went (script/i18n-plugin.ts); the development server has none.
 */
export function I18nPreload() {
  if (!isServer || !preloads) return null
  const language = useLanguage()
  const matches = useCurrentMatches()
  const files = preloads[language.locale()]
  const routes = matches().flatMap((match) => {
    const src = (match.route.key as { $component?: { src?: string } }).$component?.src
    return src ? [files.routes[src.replace(/^src\//, "").replace(/\?.*$/, "")]] : []
  })
  const hrefs = [files.table, files.shell, ...routes].filter((href) => typeof href === "string")
  useAssets(() => ssr(hrefs.map((href) => `<link href="${href}" rel="modulepreload" />`).join("")) as unknown as Element)
  return null
}
