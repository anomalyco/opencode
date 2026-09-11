export * as Ranking from "./rank"

import type { FetchedPage, SearchResultItem, Source, SourceType } from "./types"
import { hostnameOf } from "./types"

const OFFICIAL_DOMAINS = new Set([
  "nvd.nist.gov",
  "cve.org",
  "security-tracker.debian.org",
  "msrc.microsoft.com",
  "support.microsoft.com",
  "kb.cert.org",
  "oss-security.openwall.org",
  "security.apple.com",
  "chromereleases.googleblog.com",
  "gitlab.com",
  "github.com",
  "git.kernel.org",
  "kernel.org",
  "bugzilla.kernel.org",
  "docs.python.org",
  "nodejs.org",
  "developer.mozilla.org",
  "golang.org",
  "pkg.go.dev",
  "npmjs.com",
  "reactjs.org",
  "typescriptlang.org",
  "duckdb.org",
  "sqlite.org",
  "postgresql.org",
  "mysql.com",
  "redis.io",
  "mongodb.com",
  "kubernetes.io",
  "docker.com",
  "traefik.io",
  "nginx.org",
  "apache.org",
  "argon2.org",
  "www.rfc-editor.org",
  "rfc-editor.org",
  "datatracker.ietf.org",
  "www.w3.org",
  "w3.org",
  "cncf.io",
  "cloudflare.com",
  "aws.amazon.com",
  "registry.khronos.org",
  "wasmtime.dev",
  "llvm.org",
  "clang.org",
  "openai.com",
  "anthropic.com",
  "modelscope.cn",
  "huggingface.co",
])

const DEFAULT_TYPE_SCORES: Record<SourceType, number> = {
  official: 0.98,
  paper: 0.96,
  github: 0.91,
  blog: 0.84,
  forum: 0.51,
  seo: 0.22,
  unknown: 0.5,
}

export function classifySourceType(domain: string, url: string): SourceType {
  const d = domain.toLowerCase()
  const isCanonicalReference = d.endsWith("github.com") || d.endsWith("gitlab.com") || d.endsWith("git.kernel.org")
  if (OFFICIAL_DOMAINS.has(d) || d.endsWith(".gov") || d.endsWith(".edu") || d.endsWith(".mil")) return "official"
  if (url.includes("arxiv.org") || d.endsWith(".pdf") || url.endsWith(".pdf") || d.includes("research")) return "paper"
  if (isCanonicalReference || d.includes("github") || d.includes("gitlab")) return "github"
  if (d.includes("forum") || d.includes("reddit") || d.includes("stackoverflow") || d.includes("quora")) return "forum"
  if (url.includes("?utm") || url.includes("?ref") || url.endsWith("/advertorial")) return "seo"
  return "blog"
}

export function temporalFreshness(published?: string): number {
  if (!published) return 0.5
  const parsed = Date.parse(published)
  if (Number.isNaN(parsed)) return 0.5
  const days = Math.max(0, (Date.now() - parsed) / 86_400_000)
  if (days <= 30) return 1
  if (days <= 180) return 0.8
  if (days <= 365) return 0.6
  if (days <= 730) return 0.45
  return 0.3
}

function relevanceScore(query: string, item: SearchResultItem): number {
  const q = query.toLowerCase()
  const title = item.title.toLowerCase()
  const snippet = item.snippet.toLowerCase()
  if (!q) return 0.5
  const qTokens = q.split(/\s+/)
  const titleHits = qTokens.filter((t) => title.includes(t)).length
  const snippetHits = qTokens.filter((t) => snippet.includes(t)).length
  return 0.4 * (titleHits / qTokens.length) + 0.3 * (snippetHits / qTokens.length) + (title.includes(q) ? 0.1 : 0)
}

export function rankSources(
  results: SearchResultItem[],
  fetches: FetchedPage[],
  goal: string,
  maxSources: number,
): Source[] {
  const fetched = new Map(fetches.map((f) => [hostnameOf(f.url), f]))
  const fetchedByURL = new Map(fetches.map((f) => [f.canonicalURL, f]))

  const ranked = results.map((item) => {
    const domain = hostnameOf(item.url)
    const page = fetchedByURL.get(item.url) ?? fetched.get(domain)
    const sourceType = classifySourceType(domain, item.url)
    const typeScore = DEFAULT_TYPE_SCORES[sourceType]
    const freshness = temporalFreshness(item.published)
    const relevancy = relevanceScore(goal, item)
    const completeness = page
      ? Math.min(1, page.markdown.length / 8000)
      : item.snippet.length > 200 ? 0.6 : item.snippet.length > 80 ? 0.4 : 0.2
    const evidenceQuality = page ? (page.markdown.length > 4000 ? 0.2 : page.markdown.length > 1000 ? 0.1 : 0.05) : 0
    const originality = sourceType === "seo" ? -0.15 : sourceType === "forum" ? 0.05 : 0.1

    let score = typeScore * 0.3 + freshness * 0.15 + relevancy * 0.35 + completeness * 0.1 + evidenceQuality * 0.08 + originality
    score = Math.max(0, Math.min(1, score))

    return {
      rank: 0 as unknown as number,
      title: item.title || page?.title || domain,
      url: item.url,
      domain,
      sourceType,
      score,
      snippet: item.snippet || page?.markdown.slice(0, 200) || "",
    }
  })

  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, maxSources).map((s, i) => ({ ...s, rank: i + 1 }))
}