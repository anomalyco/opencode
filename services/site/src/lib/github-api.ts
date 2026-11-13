// Server-side GitHub API calls for the site (the changelog's releases). The Worker holds no GitHub
// token: calls are unauthenticated (60 an hour per IP), so callers cache for 15 minutes in memory
// and at the edge (lib/edge-cache.ts) and fall back to the build-time snapshot
// (script/github-snapshot.ts, which CI runs with the workflow's own GITHUB_TOKEN at build time only).

/** A GitHub API response, or undefined when the call failed or timed out. */
export async function githubFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "OpenCode-Website",
    },
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined)
}

/** The parsed JSON of a successful GitHub API response, or undefined. */
export async function githubJson(url: string) {
  const response = await githubFetch(url)
  if (!response?.ok) return undefined
  return response.json().catch(() => undefined)
}

/**
 * The last good GitHub data on disk, in dev only, so a dev server restart while the API is rate
 * limited still has something to show. Production keeps it in memory (and at the edge).
 */
export const githubDevCache = {
  async read<T>(key: string): Promise<T | undefined> {
    if (!import.meta.env.DEV) return undefined
    const { readFile } = await import("node:fs/promises")
    return readFile(await cachePath(key), "utf8")
      .then((text) => JSON.parse(text) as T)
      .catch(() => undefined)
  },
  async write(key: string, value: unknown) {
    if (!import.meta.env.DEV) return
    const { mkdir, writeFile } = await import("node:fs/promises")
    const path = await cachePath(key)
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true })
    await writeFile(path, JSON.stringify(value)).catch(() => {})
  },
}

async function cachePath(key: string) {
  const { tmpdir } = await import("node:os")
  return `${tmpdir()}/opencode-site-github/${key}.json`
}
