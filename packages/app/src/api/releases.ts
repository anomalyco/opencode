import type { Platform } from "@/context/platform"

const REPO = "anomalyco/opencode"
const GITHUB_API_URL = `https://api.github.com/repos/${REPO}/releases`
const PER_PAGE = 30
const CACHE_TTL = 1000 * 60 * 30
const CACHE_KEY = "opencode.releases"

type Release = {
  tag: string
  body: string
  date: string
}

function loadCache() {
  const raw = localStorage.getItem(CACHE_KEY)
  return raw ? JSON.parse(raw) : null
}

function saveCache(data: { releases: Release[]; timestamp: number }) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data))
}

export async function fetchReleases(platform: Platform): Promise<{ releases: Release[] }> {
  const now = Date.now()
  const cached = loadCache()

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return { releases: cached.releases }
  }

  const fetcher = platform.fetch ?? fetch
  const res = await fetcher(`${GITHUB_API_URL}?per_page=${PER_PAGE}`, {
    headers: { Accept: "application/vnd.github.v3+json" },
  }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load"))))

  const releases = (Array.isArray(res) ? res : []).map((r) => ({
    tag: r.tag_name ?? "Unknown",
    body: (r.body ?? "")
      .replace(/#(\d+)/g, (_: string, id: string) => `[#${id}](https://github.com/anomalyco/opencode/pull/${id})`)
      .replace(/@([a-zA-Z0-9_-]+)/g, (_: string, u: string) => `[@${u}](https://github.com/${u})`),
    date: r.published_at ?? "",
  }))

  saveCache({ releases, timestamp: now })

  return { releases }
}

export type { Release }
