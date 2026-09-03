import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const ECOSYSTEM_URL = "https://opencode.ai/docs/ecosystem/"
const AWESOME_URL = "https://raw.githubusercontent.com/awesome-opencode/awesome-opencode/main/README.md"
const NPM_REGISTRY = "https://registry.npmjs.org/"
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week/"
const CACHE_FILE = "plugin-catalog-cache.json"
const TTL_MS = 24 * 60 * 60 * 1000

export type CatalogEntry = {
  name: string
  description?: string
  version?: string
  downloadsLastWeek?: number
  updatedAt?: string
  repository?: string
  onNpm: boolean
  source: "ecosystem" | "awesome"
}

export type CatalogResult = { entries: CatalogEntry[]; fetchedAt: number; stale: boolean }

type RawEntry = { name: string; description?: string; url?: string; source: "ecosystem" | "awesome" }

export function createCatalogFetcher(deps: {
  fetchImpl?: typeof fetch
  cacheDir: string
  now?: () => number
}) {
  const doFetch = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  let memory: { result: CatalogResult; at: number } | undefined

  const parseEcosystem = (html: string): RawEntry[] => {
    const out: RawEntry[] = []
    // The docs page renders plugins in tables: [name](link) — description.
    // Match anchor + following description cell.
    const rowRe = /<td>\s*<a href="([^"]+)">([^<]+)<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>/g
    let m: RegExpExecArray | null
    while ((m = rowRe.exec(html))) {
      const name = m[2].trim()
      if (!name || name === "Name") continue
      out.push({ name, description: decodeEntities(m[3].trim()), url: m[1], source: "ecosystem" })
    }
    return out
  }

  const parseAwesome = (md: string): RawEntry[] => {
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
    const repo = entry.url?.match(/github\.com\/[^/]+\/([^/#?]+)/)?.[1]
    if (repo) candidates.push(decodeURIComponent(repo))
    return candidates.find((c) => /^[a-z@][\w./@-]*$/i.test(c)) ?? candidates[0]
  }

  async function fetchCatalog(): Promise<CatalogResult> {
    if (memory && now() - memory.at < TTL_MS) return memory.result

    let result: CatalogResult
    try {
      result = await fetchFresh()
      memory = { result, at: now() }
    } catch {
      const cached = await readDiskCache()
      if (cached) return { ...cached, stale: true }
      throw new Error("Failed to fetch plugin catalog and no cache available")
    }
    await writeDiskCache(result)
    return result
  }

  async function fetchFresh(): Promise<CatalogResult> {
    const [ecoRes, awesomeRes] = await Promise.all([
      doFetch(ECOSYSTEM_URL).then((r) => r.text()),
      doFetch(AWESOME_URL).then((r) => r.text()).catch(() => ""),
    ])
    const raw = [...parseEcosystem(ecoRes), ...parseAwesome(awesomeRes)]

    // Dedupe by npm-ish name, ecosystem wins
    const byName = new Map<string, RawEntry>()
    for (const entry of raw) {
      const key = entry.name.toLowerCase()
      if (!byName.has(key)) byName.set(key, entry)
    }

    const entries: CatalogEntry[] = []
    for (const entry of byName.values()) {
      const candidate = npmName(entry)
      const base: CatalogEntry = {
        name: entry.name,
        description: entry.description,
        repository: entry.url,
        onNpm: false,
        source: entry.source,
      }
      if (!candidate) {
        entries.push(base)
        continue
      }
      try {
        const packRes = await doFetch(NPM_REGISTRY + encodeURIComponent(candidate))
        if (packRes.ok) {
          const pack = (await packRes.json()) as any
          const latest = pack["dist-tags"]?.latest as string | undefined
          const versionMeta = latest ? pack.versions?.[latest] : undefined
          entries.push({
            ...base,
            name: candidate || entry.name,
            onNpm: true,
            version: latest,
            description: (versionMeta?.description as string | undefined) ?? base.description,
            repository:
              (typeof versionMeta?.repository?.url === "string"
                ? versionMeta.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")
                : undefined) ?? base.repository,
            updatedAt: pack.time?.modified as string | undefined,
          })
          try {
            const dlRes = await doFetch(NPM_DOWNLOADS + encodeURIComponent(candidate))
            if (dlRes.ok) {
              const dl = (await dlRes.json()) as { downloads?: number }
              entries[entries.length - 1].downloadsLastWeek = dl.downloads
            }
          } catch {
            /* downloads are optional */
          }
        } else {
          entries.push(base)
        }
      } catch {
        entries.push(base)
      }
    }

    return { entries, fetchedAt: now(), stale: false }
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

  return { fetchCatalog }
}