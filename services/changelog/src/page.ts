import { escape, type ChangelogEntry } from "./markdown"
import { style } from "./style"

const SITE = "https://opencode.ai"
const REPO = "https://github.com/anomalyco/opencode"
export const CHANGELOG_FILE_URL = `${REPO}/blob/dev/CHANGELOG.md`

const logo =
  '<svg viewBox="0 0 234 42" role="img" aria-label="OpenCode" xmlns="http://www.w3.org/2000/svg"><path d="M18 30H6V18H18V30Z" class="i"/><path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" class="o"/><path d="M48 30H36V18H48V30Z" class="i"/><path d="M36 30H48V12H36V30ZM54 36H36V42H30V6H54V36Z" class="o"/><path d="M84 24V30H66V24H84Z" class="i"/><path d="M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z" class="o"/><path d="M108 36H96V18H108V36Z" class="i"/><path d="M108 12H96V36H90V6H108V12ZM114 36H108V12H114V36Z" class="o"/><path d="M144 30H126V18H144V30Z" class="i"/><path d="M144 12H126V30H144V36H120V6H144V12Z" class="c"/><path d="M168 30H156V18H168V30Z" class="i"/><path d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z" class="c"/><path d="M198 30H186V18H198V30Z" class="i"/><path d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" class="c"/><path d="M234 24V30H216V24H234Z" class="i"/><path d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" class="c"/></svg>'

const download =
  '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M12.1875 9.75L9.00001 12.9375L5.8125 9.75M9.00001 2.0625L9 12.375M14.4375 15.9375H3.5625" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>'

const external = 'target="_blank" rel="noopener noreferrer"'

function formatDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

function release(entry: ChangelogEntry, open: boolean) {
  const date = entry.date ? `<time datetime="${entry.date}">${formatDate(entry.date)}</time>` : ""
  const intro = entry.intro ? `<div class="markdown intro">${entry.intro}</div>` : ""
  const highlights =
    entry.highlights.length === 0
      ? ""
      : `<section class="highlights"><h3 class="label">Highlights</h3><ul>${entry.highlights
          .map((item) => `<li>${item.title ? `<p class="title">${item.title}</p>` : ""}<p>${item.body}</p></li>`)
          .join("")}</ul></section>`
  const sections =
    entry.sections.length === 0
      ? ""
      : `<div class="sections">${entry.sections
          .map(
            (section) =>
              `<details class="section"${open ? " open" : ""}><summary><span class="label">${escape(section.title)}</span></summary><div class="markdown">${section.body}</div></details>`,
          )
          .join("")}</div>`

  return `<article class="release" id="${escape(entry.anchor)}"><header><h2><a href="#${escape(entry.anchor)}">${escape(entry.tag)}</a></h2>${date}</header>${intro}${highlights}${sections}</article>`
}

export type PageState = { type: "ok"; entries: ChangelogEntry[] } | { type: "error" } | { type: "not-found" }

/** Renders the whole page; entries arrive with their Markdown already rendered to safe HTML. */
export function renderPage(state: PageState) {
  const body = (() => {
    if (state.type === "error")
      return `<p class="notice">The changelog could not be loaded right now. <a href="${CHANGELOG_FILE_URL}" ${external}>View it on GitHub</a></p>`
    if (state.type === "not-found")
      return `<p class="notice">That page does not exist. <a href="/changelog">See all releases</a></p>`
    if (state.entries.length === 0) return `<p class="notice">No changelog entries found.</p>`
    return state.entries.map((entry, index) => release(entry, index === 0)).join("")
  })()

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenCode | Changelog</title>
<meta name="description" content="OpenCode release notes and changelog">
<link rel="canonical" href="${SITE}/changelog">
<link rel="icon" href="/favicon.ico">
<link rel="preload" href="/changelog/fonts/IBMPlexSerif-Regular-Latin1.woff2" as="font" type="font/woff2" crossorigin>
<meta property="og:title" content="OpenCode | Changelog">
<meta property="og:description" content="OpenCode release notes and changelog">
<meta property="og:url" content="${SITE}/changelog">
<style>${style}</style>
</head>
<body>
<header class="top"><div class="top-inner">
<a class="logo" href="${SITE}/">${logo}</a>
<nav><ul class="nav">
<li><a href="${REPO}" ${external}>GitHub</a></li>
<li><a href="${SITE}/v2/docs">Docs</a></li>
<li><a href="${SITE}/data">Data</a></li>
<li><a href="${SITE}/zen">Zen</a></li>
<li><a href="${SITE}/go">Go</a></li>
<li><a href="${SITE}/enterprise">Enterprise</a></li>
<li><a class="cta" href="${SITE}/download">${download}Download</a></li>
</ul></nav>
</div></header>
<main>
<section class="hero"><h1>Changelog</h1><p>New updates and improvements to OpenCode</p></section>
<div class="releases">${body}</div>
<p class="v1"><a href="${REPO}/releases" ${external}>OpenCode 1 release notes are on GitHub Releases</a></p>
</main>
<footer>
<a href="${REPO}" ${external}>GitHub</a>
<a href="${SITE}/docs">Docs</a>
<a href="${SITE}/changelog">Changelog</a>
<a href="${SITE}/discord">Discord</a>
<a href="https://x.com/opencode">X</a>
</footer>
<div class="legal">
<span>©${new Date().getUTCFullYear()} <a href="https://anoma.ly">Anomaly</a></span>
<a href="${SITE}/brand">Brand</a>
<a href="${SITE}/legal/privacy-policy">Privacy</a>
<a href="${SITE}/legal/terms-of-service">Terms</a>
</div>
</body>
</html>
`
}
