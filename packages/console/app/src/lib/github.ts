import { query } from "@solidjs/router"
import { config } from "~/config"
import { employees, faces, pinned } from "~/lib/contributor-faces"
import { githubDevCache, githubFetch, githubJson } from "~/lib/github-api"
import { githubSnapshot, type GithubRepo } from "~/lib/github-snapshot"
import { staleValue } from "~/lib/edge-cache"

export type Contributor = { login: string; avatar: string }

export type RepoStats = {
  stars?: number
  /** Everyone with a commit on the default branch, including authors without a GitHub account (as GitHub counts them on the repo page). */
  contributors?: number
  /** The contributors whose avatar is a photo of their face (lib/contributor-faces.ts), pinned ones first. Never empty. */
  people: Contributor[]
}

// What GitHub last told us. `order` is the allowlisted user ids in GitHub's contribution order.
type Live = GithubRepo

const api = config.github.repoUrl.replace("https://github.com/", "https://api.github.com/repos/")
const faceIds = new Set(faces.map((face) => face.id))

// The numbers are reused for 15 minutes and refreshed in the background (lib/edge-cache.ts), so a
// render never waits on GitHub for more than 300 ms. Without any good value yet (a new isolate at a
// new location, or GitHub failing), the build-time snapshot stands in, and with none of that the
// fields are left out for the page's config fallback. Dev keeps the last good value on disk too.
let previous: Live | undefined
const live = staleValue<Live>({
  key: "github/repo-stats",
  freshFor: 15 * 60_000,
  wait: 300,
  load: refresh,
  fallback: async () => (await githubDevCache.read<Live>("repo-stats")) ?? (await githubSnapshot()).repo,
})

/** Repo numbers for the site, live from GitHub where it answers. The avatars never need it. */
export async function loadRepoStats(): Promise<RepoStats> {
  const result = await live()
  previous = result.value ?? previous
  return stats(result.value ?? {})
}

async function refresh(): Promise<Live | undefined> {
  const previousLive = previous ?? (await githubDevCache.read<Live>("repo-stats")) ?? {}
  const [meta, count, first, second] = await Promise.all([
    githubJson(api),
    // One contributor per page, so the last page number is the count.
    githubFetch(`${api}/contributors?per_page=1&anon=1`),
    // The faces allowlist was reviewed from the top 200.
    githubJson(`${api}/contributors?per_page=100`),
    githubJson(`${api}/contributors?per_page=100&page=2`),
  ])
  const last = count?.ok
    ? count.headers
        .get("Link")
        ?.match(/[?&]page=(\d+)>; rel="last"/)
        ?.at(1)
    : undefined
  // Nothing answered (a rate limit or an outage): keep the last good value.
  if (typeof meta?.stargazers_count !== "number" && !last && !Array.isArray(first)) return
  const next = {
    stars: typeof meta?.stargazers_count === "number" ? meta.stargazers_count : previousLive.stars,
    contributors: last ? Number.parseInt(last) : previousLive.contributors,
    order: Array.isArray(first)
      ? [...first, ...(Array.isArray(second) ? second : [])]
          .map((person) => person.id)
          .filter((id) => typeof id === "number" && faceIds.has(id))
      : previousLive.order,
  }
  await githubDevCache.write("repo-stats", next)
  return next
}

// The allowlist as the wall shows it: pinned first, then the other employees, then everyone else.
// Past the pinned ones, each group follows GitHub's live contribution order, or the stored counts
// without it, and allowlisted people missing from the live list go last in their group. Avatars
// come straight from the user id, so they show even when the API doesn't answer.
function stats(live: Live): RepoStats {
  const group = (id: number) => (pinned.includes(id) ? 0 : employees.includes(id) ? 1 : 2)
  const position = (id: number) => {
    const pin = pinned.indexOf(id)
    if (pin !== -1) return pin - pinned.length
    const index = live.order?.indexOf(id) ?? -1
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  const people = faces
    .toSorted(
      (a, b) => group(a.id) - group(b.id) || position(a.id) - position(b.id) || b.contributions - a.contributions,
    )
    .slice(0, 72)
    .map((face) => ({
      login: face.login,
      avatar: face.avatar ?? `https://avatars.githubusercontent.com/u/${face.id}?v=4`,
    }))
  return { stars: live.stars, contributors: live.contributors, people }
}

export const github = query(async () => {
  "use server"
  const stats = await loadRepoStats()
  return { stars: stats.stars, contributors: stats.contributors ?? 0 }
}, "github")

/** Everything the home page's open source proof shows. */
export const repoStats = query(async () => {
  "use server"
  return loadRepoStats()
}, "repo-stats")
