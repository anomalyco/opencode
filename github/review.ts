export type InlineReviewComment = {
  path: string
  line: number
  body: string
}

export type InlineReviewResponse = {
  summary: string
  comments: InlineReviewComment[]
}

export function parseInlineReviewResponse(response: string): InlineReviewResponse {
  const parsed = parseJsonResponse(response)
  if (!parsed || typeof parsed !== "object") {
    return { summary: response.trim() || "lgtm", comments: [] }
  }

  const value = parsed as { summary?: unknown; comments?: unknown }
  const summary = typeof value.summary === "string" ? value.summary.trim() : response.trim()
  const comments = Array.isArray(value.comments)
    ? value.comments
        .map((comment: unknown) => {
          const item = comment as { path?: unknown; line?: unknown; body?: unknown }
          return {
            path: typeof item.path === "string" ? item.path.trim() : "",
            line: typeof item.line === "number" ? item.line : Number.NaN,
            body: typeof item.body === "string" ? item.body.trim() : "",
          }
        })
        .filter(
          (comment) =>
            comment.path.length > 0 && Number.isInteger(comment.line) && comment.line > 0 && comment.body.length > 0,
        )
    : []

  return {
    summary: summary || "lgtm",
    comments,
  }
}

function parseJsonResponse(response: string) {
  const trimmed = response.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const jsonText = fenced?.[1]?.trim() || trimmed

  try {
    return JSON.parse(jsonText) as unknown
  } catch {
    return undefined
  }
}
