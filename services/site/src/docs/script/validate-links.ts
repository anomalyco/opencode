// Fails when a link on a prerendered docs page points at a missing file or anchor in the site's built
// assets (the directory given), or, outside /docs, at a page the site doesn't have (the shell's nav and
// footer link the site's pages, which render in the Worker, so they're checked against src/routes).
// It also fails when a latest docs page's head hreflang links differ from the sitemap's alternates
// for that URL (a fallback page uses its canonical English page's). The V1 docs (/v1/docs,
// redirected to their own app), the status page, Data and the Console are other apps.
//
//   bun src/docs/script/validate-links.ts .output/public
import path from "node:path"
import { LOCALES, strip } from "../../lib/language"
import { docsSets, latestDocs } from "../config"
import { docsLocaleHref } from "../lib/navigation"

const root = path.resolve(process.argv[2] ?? ".output/public")
const routes = path.resolve(import.meta.dir, "../../routes")
const externalRoutes = /^\/(v1\/docs|status|data|console)(\/|$)/
// Every language's docs pages, beside the set (config.ts latestDocsLocales; V1's languages are in
// its slugs, so it has one root).
const docsRoots = docsSets.flatMap((set) =>
  set.id === "latest" ? LOCALES.map((locale) => docsLocaleHref("index", set, locale)) : [set.base],
)
const isDocs = (pathname: string) => docsRoots.some((base) => `${pathname}/`.startsWith(base))

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
    docsRoots.map((base) =>
      Array.fromAsync(new Bun.Glob(`${base.slice(1)}**/*.html`).scan({ cwd: root, absolute: true })),
    ),
  )
).flat()
const linkFailures = (
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
          // The shell's links take the page's language; the site's routes are written without it.
          if (!isDocs(url.pathname) && !url.hash && (await sitePage(strip(url.pathname)))) return

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

const hreflang = await checkHreflang()
const failures = [...linkFailures, ...hreflang.failures]
if (failures.length === 0) {
  console.log(`docs: checked hreflang on ${hreflang.pages} pages (${hreflang.noindex} noindex, no alternates)`)
  process.exit(0)
}
console.error([...new Set(failures)].sort().join("\n"))
process.exit(1)

/**
 * Fails when a built latest docs page's head hreflang links differ from the sitemap's alternates
 * for its URL. A fallback page is not in the sitemap: it canonicalises to English and must list
 * English and x-default only, not every language of its canonical page (other languages have
 * their own translation of it).
 */
async function checkHreflang() {
  const xml = await Bun.file(path.join(root, latestDocs.base, "sitemap.xml")).text()
  const alternates = new Map<string, string>()
  for (const match of xml.matchAll(/<url><loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/g)) {
    const links = [...match[2].matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
      .map((link) => `${link[1]} ${link[2]}`)
      .toSorted()
    alternates.set(new URL(match[1]).pathname, links.join("\n"))
  }
  const pages = (
    await Promise.all(
      LOCALES.map((locale) =>
        Array.fromAsync(
          new Bun.Glob(`${docsLocaleHref("index", latestDocs, locale).slice(1)}**/*.html`).scan({
            cwd: root,
            absolute: true,
          }),
        ),
      ),
    )
  ).flat()
  const failures: string[] = []
  let noindex = 0
  for (const file of pages) {
    const html = await Bun.file(file).text()
    const head = html.slice(0, html.indexOf("</head>"))
    const links = [...head.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
      .map((link) => `${link[1]} ${link[2]}`)
      .toSorted()
    const page = `/${path.relative(root, file).replace(/index\.html$/, "")}`
    const shown = path.relative(root, file)
    // A noindex page is not submitted in any language: it keeps no hreflang and no sitemap entry.
    if (/<meta name="robots" content="noindex"/.test(head)) {
      noindex++
      if (links.length) failures.push(`${shown}: noindex page emits hreflang [${links.join(", ")}]`)
      if (alternates.has(page)) failures.push(`${shown}: sitemap lists noindex ${page}`)
      continue
    }
    const canonical = head.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
    const canonicalPath = canonical ? new URL(canonical).pathname : undefined
    const listed = alternates.get(page)
    const expected = listed
      ? listed
      : canonicalPath
        ? alternates
            .get(canonicalPath)
            ?.split("\n")
            .filter((link) => link.startsWith("en ") || link.startsWith("x-default "))
            .join("\n")
        : undefined
    if (expected === undefined) {
      failures.push(
        `${shown}: no sitemap alternates for ${page}, and ${canonicalPath ?? "no canonical"} is not a listed fallback`,
      )
      continue
    }
    if (links.join("\n") !== expected)
      failures.push(
        `${shown}: head hreflang [${links.join(", ") || "none"}] differs from the sitemap's [${expected.split("\n").join(", ")}]`,
      )
  }
  return { failures, pages: pages.length, noindex }
}
