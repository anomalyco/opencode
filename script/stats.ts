#!/usr/bin/env bun

async function sendToPostHog(event: string, properties: Record<string, any>) {
  const key = process.env["POSTHOG_KEY"]

  if (!key) {
    console.warn("POSTHOG_API_KEY not set, skipping PostHog event")
    return
  }

  const response = await fetch("https://us.i.posthog.com/i/v0/e/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      distinct_id: "download",
      api_key: key,
      event,
      properties: {
        ...properties,
      },
    }),
  }).catch(() => null)

  if (response && !response.ok) {
    console.warn(`PostHog API error: ${response.status}`)
  }
}

interface Asset {
  name: string
  download_count: number
}

interface Release {
  tag_name: string
  name: string
  assets: Asset[]
}

interface NpmDownloadsRange {
  start: string
  end: string
  package: string
  downloads: Array<{
    downloads: number
    day: string
  }>
}

async function fetchNpmDownloads(packageName: string): Promise<number> {
  try {
    // Use a range from 2020 to current year + 5 years to ensure it works forever
    const currentYear = new Date().getFullYear()
    const endYear = currentYear + 5
    const response = await fetch(`https://api.npmjs.org/downloads/range/2020-01-01:${endYear}-12-31/${packageName}`)
    if (!response.ok) {
      console.warn(`Failed to fetch npm downloads for ${packageName}: ${response.status}`)
      return 0
    }
    const data: NpmDownloadsRange = await response.json()
    return data.downloads.reduce((total, day) => total + day.downloads, 0)
  } catch (error) {
    console.warn(`Error fetching npm downloads for ${packageName}:`, error)
    return 0
  }
}

async function fetchReleases(): Promise<Release[]> {
  const releases: Release[] = []
  let page = 1
  const per = 100

  while (true) {
    const url = `https://api.github.com/repos/anomalyco/opencode/releases?page=${page}&per_page=${per}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    const batch: Release[] = await response.json()
    if (batch.length === 0) break

    releases.push(...batch)
    console.log(`Fetched page ${page} with ${batch.length} releases`)

    if (batch.length < per) break
    page++
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  return releases
}

function calculate(releases: Release[]) {
  let total = 0
  const stats = []

  for (const release of releases) {
    let downloads = 0
    const assets = []

    for (const asset of release.assets) {
      downloads += asset.download_count
      assets.push({
        name: asset.name,
        downloads: asset.download_count,
      })
    }

    total += downloads
    stats.push({
      tag: release.tag_name,
      name: release.name,
      downloads,
      assets,
    })
  }

  return { total, stats }
}

async function save(githubTotal: number, npmDownloads: number) {
  const file = "STATS.md"
  const date = new Date().toISOString().split("T")[0]
  const total = githubTotal + npmDownloads

  let previousGithub = 0
  let previousNpm = 0
  let previousTotal = 0
  let content = ""

  try {
    content = await Bun.file(file).text()
    const lines = content.trim().split("\n")

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (line.startsWith("|") && !line.includes("Date") && !line.includes("---")) {
        const match = line.match(
          /\|\s*[\d-]+\s*\|\s*([\d,]+)\s*(?:\([^)]*\))?\s*\|\s*([\d,]+)\s*(?:\([^)]*\))?\s*\|\s*([\d,]+)\s*(?:\([^)]*\))?\s*\|/,
        )
        if (match) {
          previousGithub = parseInt(match[1].replace(/,/g, ""))
          previousNpm = parseInt(match[2].replace(/,/g, ""))
          previousTotal = parseInt(match[3].replace(/,/g, ""))
          break
        }
      }
    }
  } catch {
    content =
      "# Download Stats\n\n| Date | GitHub Downloads | npm Downloads | Total |\n|------|------------------|---------------|-------|\n"
  }

  const githubChange = githubTotal - previousGithub
  const npmChange = npmDownloads - previousNpm
  const totalChange = total - previousTotal

  const githubChangeStr =
    githubChange > 0
      ? ` (+${githubChange.toLocaleString()})`
      : githubChange < 0
        ? ` (${githubChange.toLocaleString()})`
        : " (+0)"
  const npmChangeStr =
    npmChange > 0 ? ` (+${npmChange.toLocaleString()})` : npmChange < 0 ? ` (${npmChange.toLocaleString()})` : " (+0)"
  const totalChangeStr =
    totalChange > 0
      ? ` (+${totalChange.toLocaleString()})`
      : totalChange < 0
        ? ` (${totalChange.toLocaleString()})`
        : " (+0)"
  const line = `| ${date} | ${githubTotal.toLocaleString()}${githubChangeStr} | ${npmDownloads.toLocaleString()}${npmChangeStr} | ${total.toLocaleString()}${totalChangeStr} |\n`

  if (!content.includes("# Download Stats")) {
    content =
      "# Download Stats\n\n| Date | GitHub Downloads | npm Downloads | Total |\n|------|------------------|---------------|-------|\n"
  }

  await Bun.write(file, content + line)
  await Bun.spawn(["bunx", "prettier", "--write", file]).exited

  console.log(
    `\nAppended stats to ${file}: GitHub ${githubTotal.toLocaleString()}${githubChangeStr}, npm ${npmDownloads.toLocaleString()}${npmChangeStr}, Total ${total.toLocaleString()}${totalChangeStr}`,
  )
}

console.log("Fetching GitHub releases for anomalyco/opencode...\n")

const releases = await fetchReleases()
console.log(`\nFetched ${releases.length} releases total\n`)

const { total: githubTotal, stats } = calculate(releases)

console.log("Fetching npm all-time downloads for opencode-ai...\n")
const npmDownloads = await fetchNpmDownloads("opencode-ai")
console.log(`Fetched npm all-time downloads: ${npmDownloads.toLocaleString()}\n`)

await save(githubTotal, npmDownloads)

await sendToPostHog("download", {
  count: githubTotal,
  source: "github",
})

await sendToPostHog("download", {
  count: npmDownloads,
  source: "npm",
})

const totalDownloads = githubTotal + npmDownloads

console.log("=".repeat(60))
console.log(`TOTAL DOWNLOADS: ${totalDownloads.toLocaleString()}`)
console.log(`  GitHub: ${githubTotal.toLocaleString()}`)
console.log(`  npm: ${npmDownloads.toLocaleString()}`)
console.log("=".repeat(60))

console.log("-".repeat(60))
console.log(`GitHub Total: ${githubTotal.toLocaleString()} downloads across ${releases.length} releases`)
console.log(`npm Total: ${npmDownloads.toLocaleString()} downloads`)
console.log(`Combined Total: ${totalDownloads.toLocaleString()} downloads`)
