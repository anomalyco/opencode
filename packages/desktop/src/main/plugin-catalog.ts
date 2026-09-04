import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const ECOSYSTEM_URL = "https://opencode.ai/docs/ecosystem/"
const AWESOME_URL = "https://raw.githubusercontent.com/awesome-opencode/awesome-opencode/main/README.md"
const CAFE_URL = "https://raw.githubusercontent.com/R44VC0RP/opencode.cafe/main/bulk/plugins.json"
const NPM_REGISTRY = "https://registry.npmjs.org/"
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week/"
const CACHE_FILE = "plugin-catalog-cache.json"
const TTL_MS = 24 * 60 * 60 * 1000

export type CatalogSource = "ecosystem" | "awesome" | "cafe"

export type CatalogEntry = {
  name: string
  description?: string
  version?: string
  downloadsLastWeek?: number
  updatedAt?: string
  repository?: string
  onNpm: boolean
  source: CatalogSource
}

export type CatalogResult = { entries: CatalogEntry[]; fetchedAt: number; stale: boolean }

type RawEntry = { name: string; description?: string; url?: string; source: CatalogSource }

const NPM_CONCURRENCY = 12

export function createCatalogFetcher(deps: {
  fetchImpl?: typeof fetch
  cacheDir: string
  now?: () => number
}) {
  const doFetch = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  let memory: { result: CatalogResult; at: number } | undefined
  let refresh: Promise<void> | undefined

  const parseEcosystem = (html: string): RawEntry[] => {
    const out: RawEntry[] = []
    // The docs page renders plugins in tables: [name](link) — description.
    // Match anchor + following description cell (may contain inline markup like <code>).
    const rowRe = /<td>\s*<a href="([^"]+)">([^<]+)<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>/g
    let m: RegExpExecArray | null
    while ((m = rowRe.exec(html))) {
      const name = m[2].trim()
      if (!name || name === "Name") continue
      out.push({ name, description: decodeEntities(stripTags(m[3].trim())), url: m[1], source: "ecosystem" })
    }
    return out
  }

  const parseAwesome = (md: string): RawEntry[] => {
    // Live README uses <details>/<summary> blocks under <div id="plugins">.
    const scope = md.match(/<div id="plugins">[\s\S]*?(?=<div id="|$)/)?.[0]
    if (scope) {
      const out: RawEntry[] = []
      const sumRe = /<summary><b>([^<]+)<\/b>([\s\S]*?)<\/summary>/g
      const hits: { name: string; desc?: string; end: number }[] = []
      let m: RegExpExecArray | null
      while ((m = sumRe.exec(scope))) {
        hits.push({
          name: m[1].trim(),
          desc: m[2].match(/<i>([^<]*)<\/i>/)?.[1]?.trim(),
          end: m.index + m[0].length,
        })
      }
      for (let i = 0; i < hits.length; i++) {
        // Search for the repository link between this summary and the next one.
        const nextStart = i + 1 < hits.length ? scope.indexOf("<summary><b>", hits[i].end) : scope.length
        const chunk = scope.slice(hits[i].end, nextStart === -1 ? scope.length : nextStart)
        const url = chunk.match(/href="(https:\/\/github\.com\/[^"]+)"/)?.[1]
        if (hits[i].name && hits[i].name.toLowerCase() !== "name") {
          out.push({ name: hits[i].name, description: hits[i].desc, url, source: "awesome" })
        }
      }
      if (out.length) return out
    }
    // Fallback: markdown bullet list under a "## Plugins" heading.
    const out: RawEntry[] = []
    const inSection = md.match(/##\s*Plugins[\s\S]*?(?=\n##\s|\*$)/)
    const body = inSection?.[0] ?? md
    const lineRe = /-\s*\[([^\]]+)\]\(([^)]+)\)\s*[-–—]\s*(.+)/g
    let m: RegExpExecArray | null
    while ((m = lineRe.exec(body))) {
      const name = m[1].trim()
      if (!name || name.toLowerCase() === "name") continue
      out.push({ name, description: m[3].trim(), url: m[2], source: "awesome" })
    }
    return out
  }

  const parseCafe = (raw: string): RawEntry[] => {
    // opencode.cafe publishes a structured JSON list of marketplace entries.
    // Only entries with type "plugin" belong in the plugin catalog.
    try {
      const parsed = JSON.parse(raw)
      const items = Array.isArray(parsed) ? parsed : (parsed?.plugins ?? [])
      if (!Array.isArray(items)) return []
      const out: RawEntry[] = []
      for (const item of items) {
        if (typeof item !== "object" || item === null) continue
        const type = (item as { type?: unknown }).type
        if (type !== "plugin") continue
        const productId = (item as { productId?: unknown }).productId
        const name = typeof productId === "string" ? productId : (item as { displayName?: unknown }).displayName
        if (typeof name !== "string" || !name.trim()) continue
        const description = (item as { description?: unknown }).description
        const repoUrl = (item as { repoUrl?: unknown }).repoUrl
        out.push({
          name: name.trim(),
          description: typeof description === "string" ? description : undefined,
          url: typeof repoUrl === "string" ? repoUrl : undefined,
          source: "cafe",
        })
      }
      return out
    } catch {
      return []
    }
  }

  const stripTags = (s: string) =>
    s
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()

  const decodeEntities = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")

  const npmName = (entry: RawEntry): string | undefined => {
    // Prefer npm-looking names; try slug of name first, then repo name from URL.
    const candidates = [entry.name.trim()]
    // For deep links like .../tree/main/packages/opencode-plugin the repo slug
    // ("integrations") is misleading — the last path segment is the package.
    const deep = entry.url?.match(/github\.com\/[^/]+\/[^/]+\/(?:tree|blob)\/[^/]+\/(.+?)(?:\/)?(?:[?#].*)?$/)?.[1]
    if (deep) {
      const last = deep.split("/").filter(Boolean).pop() ?? deep
      candidates.push(decodeURIComponent(last.replace(/\.git$/, "")))
    } else {
      const repo = entry.url?.match(/github\.com\/[^/]+\/([^/#?]+)/)?.[1]
      if (repo) candidates.push(decodeURIComponent(repo.replace(/\.git$/, "")))
    }
    return candidates.find((c) => /^[a-z@][\w./@-]*$/i.test(c)) ?? candidates[0]
  }

  async function fetchCatalog(): Promise<CatalogResult> {
    if (memory && now() - memory.at < TTL_MS) return memory.result

    // Cache-first: serve the disk cache instantly when present, then refresh in
    // the background. A cold fetch takes seconds (per-entry npm enrichment), and
    // the Plugins tab must not block on it.
    const cached = await readDiskCache()
    if (cached) {
      const fresh = now() - cached.fetchedAt < TTL_MS
      if (fresh) return cached
      startBackgroundRefresh()
      return { ...cached, stale: true }
    }

    let result: CatalogResult
    try {
      result = await fetchFresh()
      memory = { result, at: now() }
    } catch {
      throw new Error("Failed to fetch plugin catalog and no cache available")
    }
    await writeDiskCache(result)
    return result
  }

  function startBackgroundRefresh() {
    if (refresh) return
    refresh = fetchFresh()
      .then((result) => {
        memory = { result, at: now() }
        return writeDiskCache(result)
      })
      .catch(() => {
        /* offline during refresh — keep serving the stale cache */
      })
      .finally(() => {
        refresh = undefined
      })
  }

  // Exposed for tests: flush the background refresh.
  const refreshInBackground = () => {
    startBackgroundRefresh()
    return refresh ?? Promise.resolve()
  }

  async function fetchFresh(): Promise<CatalogResult> {
    // cafe is optional: a failure there must not take down the curated sources.
    const [ecoRes, awesomeRes, cafeRes] = await Promise.all([
      doFetch(ECOSYSTEM_URL).then((r) => {
        if (!r.ok) throw new Error(`ecosystem source returned ${r.status}`)
        return r.text()
      }),
      doFetch(AWESOME_URL).then((r) => {
        if (!r.ok) throw new Error(`awesome source returned ${r.status}`)
        return r.text()
      }),
      doFetch(CAFE_URL)
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => ""),
    ])
    const raw = [...parseEcosystem(ecoRes), ...parseAwesome(awesomeRes), ...parseCafe(cafeRes)]

    // Dedupe by npm-ish name, ecosystem wins
    const byName = new Map<string, RawEntry>()
    for (const entry of raw) {
      const key = entry.name.toLowerCase()
      if (!byName.has(key)) byName.set(key, entry)
    }

    const rawList = [...byName.values()]
    const entries: CatalogEntry[] = new Array(rawList.length)
    let cursor = 0

    // Bounded-concurrency worker pool: a sequential per-entry enrichment means
    // ~2 HTTP round-trips × ~185 entries, which takes seconds. The pool keeps
    // peak concurrency at NPM_CONCURRENCY and preserves result order.
    const worker = async () => {
      for (;;) {
        const index = cursor++
        if (index >= rawList.length) return
        entries[index] = await enrichEntry(rawList[index])
      }
    }
    await Promise.all(Array.from({ length: Math.min(NPM_CONCURRENCY, rawList.length) }, worker))

    return { entries, fetchedAt: now(), stale: false }
  }

  async function enrichEntry(entry: RawEntry): Promise<CatalogEntry> {
    const candidate = npmName(entry)
    const base: CatalogEntry = {
      name: entry.name,
      description: entry.description,
      repository: entry.url,
      onNpm: false,
      source: entry.source,
    }
    if (!candidate) return base
    try {
      const packRes = await doFetch(NPM_REGISTRY + encodeURIComponent(candidate))
      if (packRes.ok) {
        const pack = (await packRes.json()) as any
        const latest = pack["dist-tags"]?.latest as string | undefined
        const versionMeta = latest ? pack.versions?.[latest] : undefined
        const enriched: CatalogEntry = {
          ...base,
          name: candidate,
          onNpm: true,
          version: latest,
          description: (versionMeta?.description as string | undefined) ?? base.description,
          repository:
            (typeof versionMeta?.repository?.url === "string"
              ? versionMeta.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")
              : undefined) ?? base.repository,
          updatedAt: pack.time?.modified as string | undefined,
        }
        try {
          const dlRes = await doFetch(NPM_DOWNLOADS + encodeURIComponent(candidate))
          if (dlRes.ok) {
            const dl = (await dlRes.json()) as { downloads?: number }
            enriched.downloadsLastWeek = dl.downloads
          }
        } catch {
          /* downloads are optional */
        }
        return enriched
      }
      return base
    } catch {
      return base
    }
  }

  async function readDiskCache(): Promise<CatalogResult | undefined> {
    try {
      const content = await readFile(join(deps.cacheDir, CACHE_FILE), "utf8")
      const parsed = JSON.parse(content) as CatalogResult
      if (!Array.isArray(parsed.entries)) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  async function writeDiskCache(result: CatalogResult) {
    try {
      await mkdir(deps.cacheDir, { recursive: true })
      await writeFile(join(deps.cacheDir, CACHE_FILE), JSON.stringify(result))
    } catch {
      /* cache write failures are non-fatal */
    }
  }

  return { fetchCatalog, refreshInBackground }
}
