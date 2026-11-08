import { useCurrentMatches } from "@solidjs/router"
import { isServer, ssr, useAssets } from "solid-js/web"
import preloads from "virtual:i18n-preload"
import { useLanguage } from "~/context/language"

/**
 * Server only: preloads the page's strings in its language (the locale's table, which holds the
 * shell's, and the page route's slice), so they arrive with the page's scripts rather than after
 * them. Written like Vite's own preloads, so lib/one-stylesheet.ts gives them the same priority. The
 * client build writes where each file went (script/i18n-plugin.ts); the development server has none.
 * Called inside a component (AppMeta) rather than rendered as one, so the component tree, and the ids
 * Solid derives from it, stay as they were.
 */
export function preloadStrings() {
  if (!isServer || !preloads) return
  const language = useLanguage()
  const matches = useCurrentMatches()
  const files = preloads[language.locale()]
  const routes = matches().flatMap((match) => {
    const src = (match.route.key as { $component?: { src?: string } }).$component?.src
    return src ? [files.routes[src.replaceAll("\\", "/").replace(/^src\//, "").replace(/\?.*$/, "")]] : []
  })
  const hrefs = [files.table, ...routes].filter((href) => typeof href === "string")
  useAssets(() => ssr(hrefs.map((href) => `<link href="${href}" rel="modulepreload" />`).join("")) as unknown as Element)
}
