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

const stars = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 0,
}).format(body.stargazers_count)
const file = "packages/stats/app/src/routes/stats-shell.tsx"
const content = await Bun.file(file).text()
const pattern = /fallbackStars: "[^"]+"/

if (!pattern.test(content)) throw new Error(`GitHub star fallback not found in ${file}`)

await Bun.write(file, content.replace(pattern, `fallbackStars: "${stars}"`))
console.log(`Updated GitHub star fallback to ${stars}`)
