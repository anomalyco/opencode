#!/usr/bin/env bun

const response = await fetch("https://api.github.com/repos/anomalyco/opencode", {
  headers: {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  },
})

if (!response.ok) throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)

const body: unknown = await response.json()
if (!body || typeof body !== "object" || !("stargazers_count" in body) || typeof body.stargazers_count !== "number")
  throw new Error("GitHub API response did not include a star count")

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 0,
}).format(body.stargazers_count)
const full = new Intl.NumberFormat("en").format(Math.round(body.stargazers_count / 1_000) * 1_000)
const statsFile = "packages/stats/app/src/routes/stats-shell.tsx"
const statsContent = await Bun.file(statsFile).text()
const statsPattern = /fallbackStars: "[^"]+"/

if (!statsPattern.test(statsContent)) throw new Error(`GitHub star fallback not found in ${statsFile}`)

const siteFile = "packages/console/app/src/config.ts"
const siteContent = await Bun.file(siteFile).text()
const compactPattern = /compact: "[^"]+"/
const fullPattern = /full: "[^"]+"/

if (!compactPattern.test(siteContent) || !fullPattern.test(siteContent))
  throw new Error(`GitHub star fallbacks not found in ${siteFile}`)

await Promise.all([
  Bun.write(statsFile, statsContent.replace(statsPattern, `fallbackStars: "${compact}"`)),
  Bun.write(
    siteFile,
    siteContent.replace(compactPattern, `compact: "${compact}"`).replace(fullPattern, `full: "${full}"`),
  ),
])
console.log(`Updated GitHub star fallbacks to ${compact} (${full})`)
