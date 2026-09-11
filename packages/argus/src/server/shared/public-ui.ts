// Static UI assets the browser fetches without app-managed credentials, e.g.
// the manifest link in <head>. These bypass auth so the page can install/render
// the manifest icons even when a server password is configured.
export const PUBLIC_UI_PATHS = new Set<string>([
  "/site.webmanifest",
  "/logo.png",
  "/logo-dark.png",
  "/logowithbg.png",
])

export function isPublicUIPath(method: string, pathname: string) {
  return method === "GET" && PUBLIC_UI_PATHS.has(pathname)
}
