// Fails when a link on a prerendered docs page points at a missing file or anchor in the site's built
// assets (the directory given), or, outside /docs, at a page the site doesn't have (the shell's nav and
// footer link the site's pages, which render in the Worker, so they're checked against src/routes).
// The V1 docs (/v1/docs, redirected to their own app), the status page, Data and the Console are other
// apps.
//
//   bun src/docs/script/validate-links.ts .output/public
import path from "node:path"
import { docsSets } from "../config"

const root = path.resolve(process.argv[2] ?? ".output/public")
const routes = path.resolve(import.meta.dir, "../../routes")
const externalRoutes = /^\/(v1\/docs|status|data|console)(\/|$)/

/** Whether the site renders a page at `pathname` (src/routes/x.tsx or src/routes/x/index.tsx). */
async function sitePage(pathname: string) {
  const route = path.join(routes, pathname.replace(/\/$/, ""))
  const candidates =
    pathname === "/" ? [path.join(routes, "index.tsx")] : [`${route}.tsx`, path.join(route, "index.tsx")]
  return (await Promise.all(candidates.map((file) => Bun.file(file).exists()))).some(Boolean)
}
// Every page's ids, read once however many links name one.
const ids = new Map<string, Promise<Set<string>>>()
async function readIds(file: string) {
  const html = await Bun.file(file).text()
  return new Set(Array.from(html.matchAll(/\sid="([^"]*)"/g), (match) => match[1]))
}
const files = (
  await Promise.all(
    docsSets.map((set) =>
      Array.fromAsync(new Bun.Glob(`${set.base.slice(1)}**/*.html`).scan({ cwd: root, absolute: true })),
    ),
  )
).flat()
const failures = (
  await Promise.all(
    files.flatMap(async (file) => {
      const html = await Bun.file(file).text()
      const page = `https://opencode.local/${path.relative(root, file).replace(/index\.html$/, "")}`
      return Promise.all(
        Array.from(html.matchAll(/href="([^"]+)"/g), async (match) => {
          // Not a link on this site: an autolinked URL a translation ran into (`http://localhost:4096）`).
          if (!URL.canParse(match[1], page)) return
          const url = new URL(match[1], page)
          if (url.origin !== "https://opencode.local") return
          if (externalRoutes.test(url.pathname)) return
          const docs = docsSets.some((set) => `${url.pathname}/`.startsWith(set.base))
          if (!docs && !url.hash && (await sitePage(url.pathname))) return

          const targetPath = path.join(root, decodeURIComponent(url.pathname))
          const target = (
            await Promise.all(
              [targetPath, path.join(targetPath, "index.html"), `${targetPath}.html`].map(async (candidate) =>
                (await Bun.file(candidate).exists()) ? candidate : undefined,
              ),
            )
          ).find((candidate) => candidate !== undefined)
          if (!target) return `${path.relative(root, file)}: missing ${url.pathname}`
          if (!url.hash || !target.endsWith(".html")) return

          const id = decodeURIComponent(url.hash.slice(1))
          if (!ids.has(target)) ids.set(target, readIds(target))
          if ((await ids.get(target)!).has(id)) return
          return `${path.relative(root, file)}: missing ${url.pathname}${url.hash}`
        }),
      )
    }),
  )
)
  .flat(2)
  .filter((failure) => failure !== undefined)

if (failures.length === 0) process.exit(0)
console.error([...new Set(failures)].sort().join("\n"))
process.exit(1)
