/**
 * The pages the Worker renders as plain HTML, without hydration (src/static/render.tsx): their own
 * small script drives them (src/client/entry.ts), and links to them load the whole page. Each is a
 * page route's path in SolidStart's form (`:tag` for a parameter). Any other address that no API
 * route answers gets the not-found page, rendered the same way, so production serves no hydrated
 * page at all. The development server keeps them all hydrated: Design mode and Settings need the
 * app. perf/serve.ts serves a production build to try them.
 */
export const staticPaths = [
  "/",
  "/product",
  "/desktop",
  "/terminal",
  "/mobile",
  "/sdk",
  "/ide",
  "/mini",
  "/legal",
  "/legal/privacy-policy",
  "/legal/terms-of-service",
  "/brand",
  "/press",
  "/changelog",
  "/changelog/:tag",
  "/product/browse",
  "/font",
]

/** The static route a path (without its locale) is, if any. No imports, so the browser can use it too. */
export function staticPath(path: string) {
  return staticPaths.find((pattern) => matches(pattern, path))
}

/** Whether a path is one a route's pattern (`:tag` a segment, a trailing `*rest` the rest) matches. */
export function matches(pattern: string, path: string) {
  return new RegExp(`^${pattern.replace(/\*\w*$/, ".*").replace(/:\w+/g, "[^/]+")}/?$`).test(path)
}
