/**
 * A set of docs on the site, each mounted at its own path: every page (`/docs/cli/keybinds/`) and every
 * file the pages load or link lives under its `base`. Docs code builds its URLs from it (`docsHref`),
 * and MDX content reads it as `import.meta.env.BASE_URL` (vite.ts), as it did when the docs were their
 * own app. The sets share one stylesheet, script and fonts, under the latest docs' `_build`.
 */
export type DocsSet = {
  id: "latest"
  base: string
  /** Its MDX, from the repository root (content.ts names the same folder for Vite). */
  content: string
  /**
   * Its own files beside the pages, served as plain assets and never as pages: no page may take one of
   * these names (script/build.ts checks), the Worker serves them before the docs middleware
   * (cloudflare.config.ts runWorkerFirst), and a missing one is a 404 rather than a page.
   */
  files: readonly string[]
}

export const latestDocs: DocsSet = {
  id: "latest",
  base: "/docs/",
  content: "services/site/src/docs/content",
  files: ["_build", "assets", "pagefind", "favicon.svg", "llms.txt", "sitemap.xml", "openapi.json"],
}

export const docsSets = [latestDocs]
