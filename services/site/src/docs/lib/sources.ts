import { existsSync } from "node:fs"
import path from "node:path"

/**
 * An English page's source file by slug: `<slug>.mdx`, or `<slug>/index.mdx` for a folder index
 * page (`build` is `content/build/index.mdx`). Translations use the same slug, so every lookup
 * between a translated page and its English source goes through here (headings, stale detection,
 * stamps and orphans).
 */
export function docsSource(folder: string, slug: string) {
  const file = path.join(folder, `${slug}.mdx`)
  if (existsSync(file)) return file
  const index = path.join(folder, slug, "index.mdx")
  if (existsSync(index)) return index
}
