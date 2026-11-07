// Where the docs are mounted on the site: every page (`/docs/cli/keybinds/`) and every file the pages
// load or link lives under it. Docs code builds its URLs from this, and MDX content reads it as
// `import.meta.env.BASE_URL` (vite.ts), as it did when the docs were their own app.
export const base = "/docs/"

// The docs' own files beside the pages, served as plain assets and never as pages: no page may take
// one of these names (script/build.ts checks), the Worker serves them before the docs middleware
// (cloudflare.config.ts runWorkerFirst), and a missing one is a 404 rather than a V1 fallback.
export const files = ["_build", "assets", "pagefind", "favicon.svg", "llms.txt", "sitemap.xml", "openapi.json"]
