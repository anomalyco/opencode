/**
 * The pages the Worker renders as plain HTML, without hydration (src/static/render.tsx): their own
 * small script drives them (src/client/entry.ts), and links to them load the whole page. Each is a
 * page route's path in SolidStart's form (`:tag` for a parameter). Take one out and it is the hydrated
 * app's again, on the server and in the browser. The development server keeps them all hydrated:
 * Design mode and Settings need the app. perf/serve.ts serves a production build to try them.
 */
export const staticPaths = [
  "/legal",
  "/legal/privacy-policy",
  "/legal/terms-of-service",
  "/brand",
  "/press",
  "/changelog",
  "/changelog/:tag",
  "/product/browse",
]

/** The static route a path (without its locale) is, if any. No imports, so the browser can use it too. */
export function staticPath(path: string) {
  return staticPaths.find((pattern) => new RegExp(`^${pattern.replace(/:\w+/g, "[^/]+")}/?$`).test(path))
}
