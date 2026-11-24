import { query } from "@solidjs/router"
import { employees, faces, pinned } from "~/lib/contributor-faces"
import { githubSnapshot, type GithubRepo } from "~/lib/github-snapshot"

export type Contributor = { login: string; avatar: string }

export type RepoStats = {
  stars?: number
  /** Everyone with a commit on the default branch, including authors without a GitHub account (as GitHub counts them on the repo page). */
  contributors?: number
  /** The contributors whose avatar is a photo of their face (lib/contributor-faces.ts), pinned ones first. Never empty. */
  people: Contributor[]
}

// What GitHub said at build time. `order` is the allowlisted user ids in GitHub's contribution order.
type Live = GithubRepo

/**
 * Repo numbers for the site, from the build-time snapshot (script/github-snapshot.ts): the Worker
 * never calls GitHub's API for them and holds no GitHub token. Without a snapshot the fields are
 * left out and pages show the config's numbers. The avatars never need it.
 */
export async function loadRepoStats(): Promise<RepoStats> {
  return stats((await githubSnapshot()).repo ?? {})
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
    // The most the open source proof's two rows show at any width: 21 columns, at 1248px wide.
    .slice(0, 42)
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
