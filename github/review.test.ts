import { describe, expect, test } from "bun:test"
import { parseInlineReviewResponse } from "./review"

describe("parseInlineReviewResponse", () => {
  test("parses fenced JSON review output", () => {
    const review = parseInlineReviewResponse(`
```json
{
  "summary": "2 issues found",
  "comments": [
    { "path": "src/app.ts", "line": 12, "body": "Use an early return here." },
    { "path": "src/app.ts", "line": 25, "body": "This branch is unreachable." }
  ]
}
```
`)

    expect(review.summary).toBe("2 issues found")
    expect(review.comments).toEqual([
      { path: "src/app.ts", line: 12, body: "Use an early return here." },
      { path: "src/app.ts", line: 25, body: "This branch is unreachable." },
    ])
  })

  test("falls back to a summary-only review when the response is not JSON", () => {
    const review = parseInlineReviewResponse("lgtm")

    expect(review).toEqual({ summary: "lgtm", comments: [] })
  })
})