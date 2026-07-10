// Pure, dependency-free helpers for the github-pr-search tool.
// Kept in a separate module so they can be unit-tested without importing the
// plugin runtime (`@opencode-ai/plugin`).

export interface PR {
  number: number
  title: string
  html_url: string
  state: string
  user?: { login?: string }
  labels?: Array<{ name?: string }>
  body?: string | null
  pull_request?: { merged_at?: string | null }
}

/** GitHub Search returns state open/closed; a merged PR has pull_request.merged_at. */
export function describeState(pr: PR): string {
  if (pr.pull_request?.merged_at) return "merged"
  return pr.state ?? "unknown"
}

/** Collapse whitespace and truncate a PR body to a short snippet. */
export function snippet(body: string | null | undefined, max = 200): string {
  if (!body) return ""
  const flat = body.replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max) + "…" : flat
}

/** Clamp pagination inputs to the GitHub Search API's valid ranges. */
export function clampPaging(limit: number, page: number): { perPage: number; page: number } {
  return {
    perPage: Math.min(Math.max(Math.trunc(limit), 1), 100),
    page: Math.max(Math.trunc(page), 1),
  }
}

/** Build the GitHub Search `q` value. `state: "all"` omits the state qualifier. */
export function buildSearchQuery(
  query: string,
  owner: string,
  repo: string,
  state: "open" | "closed" | "all",
): string {
  const stateFilter = state === "all" ? "" : ` state:${state}`
  return `${query} repo:${owner}/${repo} type:pr${stateFilter}`
}

/** Render one PR into an LLM-friendly block. */
export function formatPr(pr: PR): string {
  const author = pr.user?.login ? `@${pr.user.login}` : "unknown"
  const labels = (pr.labels ?? [])
    .map((l) => l.name)
    .filter(Boolean)
    .join(", ")
  const lines = [
    `#${pr.number} — ${pr.title}`,
    `state: ${describeState(pr)} · author: ${author}${labels ? ` · labels: ${labels}` : ""}`,
    pr.html_url,
  ]
  const body = snippet(pr.body)
  if (body) lines.push(body)
  return lines.join("\n")
}
