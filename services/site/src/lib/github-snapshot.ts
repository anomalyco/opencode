// What GitHub said at build time (script/github-snapshot.ts writes github-snapshot.json, which is
// not committed). Pages fall back to it when a new Worker isolate has nothing better and GitHub
// doesn't answer quickly, so no render waits on GitHub. Loaded only on that path.

/** A release as GitHub's API lists it, with only the fields the site reads. */
export type GithubRelease = {
  tag_name: string
  name: string
  body: string
  published_at: string | null
  html_url: string
}

/** The repo numbers: `order` is the allowlisted contributor ids in GitHub's contribution order. */
export type GithubRepo = { stars?: number; contributors?: number; order?: number[] }

export type GithubSnapshot = { time?: string; repo?: GithubRepo; releases?: GithubRelease[] }

const files = import.meta.glob<GithubSnapshot>("./github-snapshot.json", { import: "default" })

export async function githubSnapshot(): Promise<GithubSnapshot> {
  const load = Object.values(files)[0]
  if (!load) return {}
  return load().catch(() => ({}))
}
