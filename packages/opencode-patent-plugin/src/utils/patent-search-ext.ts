/**
 * 外部专利检索 API
 *
 * - Google Patents: 全球专利检索
 * - Semantic Scholar: 学术论文检索
 *
 * 仅使用内置 fetch，无需额外依赖。
 */

// --- 类型 ---

export interface ExternalPatentResult {
  title: string
  patentId: string
  abstract: string
  assignee: string
  filingDate: string
  publicationDate: string
  url: string
  source: "google_patents"
}

export interface AcademicPaperResult {
  paperId: string
  title: string
  abstract: string
  authors: string[]
  year: number
  citationCount: number
  url: string
  source: "semantic_scholar"
}

// --- Google Patents ---

export async function searchGooglePatents(
  query: string,
  limit = 10,
): Promise<ExternalPatentResult[]> {
  try {
    // Google Patents XHR API（其 UI 自身使用的接口）
    const url = `https://patents.google.com/xhr/query?url=q%3D${encodeURIComponent(query)}%26num%3D${limit}%26oq%3D${encodeURIComponent(query)}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; YunPat/1.0)",
      },
    })
    clearTimeout(timeout)

    if (!response.ok) return []

    const data = await response.json() as any
    const results: ExternalPatentResult[] = []

    // 解析 Google Patents 返回结构
    const hits = data?.results?.channel?.result?.map?.result || []
    for (const hit of hits.slice(0, limit)) {
      const patent = hit?.patent
      if (!patent) continue

      results.push({
        title: patent.title || "",
        patentId: patent.publnId || "",
        abstract: patent.abstract?.value || "",
        assignee: patent.assigneeHtml || "",
        filingDate: patent.filingDate?.value || "",
        publicationDate: patent.publnDate?.value || "",
        url: `https://patents.google.com/patent/${patent.publnId}`,
        source: "google_patents",
      })
    }

    return results
  } catch {
    // API 不可用时返回空，由 Tool 层做降级处理
    return []
  }
}

// --- Semantic Scholar ---

export async function searchSemanticScholar(
  query: string,
  options?: { limit?: number; yearFrom?: number; yearTo?: number },
): Promise<AcademicPaperResult[]> {
  const limit = options?.limit || 10

  try {
    const params = new URLSearchParams({
      query,
      limit: String(limit),
      fields: "title,abstract,authors,year,citationCount,url,externalIds",
    })

    if (options?.yearFrom) params.set("year", `${options.yearFrom}-${options.yearTo || new Date().getFullYear()}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
      { signal: controller.signal },
    )
    clearTimeout(timeout)

    if (response.status === 429) return [] // 速率限制
    if (!response.ok) return []

    const data = await response.json() as any
    const results: AcademicPaperResult[] = []

    for (const paper of (data?.data || []).slice(0, limit)) {
      results.push({
        paperId: paper.paperId || paper.externalIds?.DOI || "",
        title: paper.title || "",
        abstract: paper.abstract || "",
        authors: (paper.authors || []).map((a: any) => a.name || "").filter(Boolean),
        year: paper.year || 0,
        citationCount: paper.citationCount || 0,
        url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
        source: "semantic_scholar",
      })
    }

    return results
  } catch {
    return []
  }
}
