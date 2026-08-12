import { describe, expect, test } from "bun:test"
import { feedbackIssueUrl } from "../src/feedback"
import { annotationUrl, readAnnotations } from "../src/annotations"

describe("catalog feedback", () => {
  test("opens a prefilled issue for an exact capture", () => {
    const url = new URL(
      feedbackIssueUrl({
        title: "Skill picker",
        identifier: "skill-picker",
        deepLink: "https://dev.opencode.ai/lab/catalog?screen=skill-picker&set=opencode",
        variant: "opencode",
      }),
    )

    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/anomalyco/opencode/issues/new")
    expect(url.searchParams.get("title")).toBe("[Catalog feedback] Skill picker")
    expect(url.searchParams.get("labels")).toBe("catalog,design-feedback")
    expect(url.searchParams.get("body")).toContain("`skill-picker`")
    expect(url.searchParams.get("body")).toContain("screen=skill-picker&set=opencode")
  })

  test("round-trips a capture annotation document through the URL fragment", () => {
    const document = {
      version: 1 as const,
      identifier: "skill-picker",
      variant: "opencode",
      annotations: [{ id: "one", row: 4, column: 12, note: "This label needs more contrast." }],
    }
    const url = new URL(annotationUrl("https://dev.opencode.ai/lab/catalog?screen=skill-picker", document))

    expect(url.hash).toStartWith("#annotations=")
    expect(readAnnotations(url, "skill-picker", "opencode")).toEqual(document.annotations)
    expect(readAnnotations(url, "other-screen", "opencode")).toEqual([])
  })

  test("includes human and machine-readable annotations in the issue", () => {
    const annotations = [{ id: "one", row: 4, column: 12, note: "This label needs more contrast." }]
    const document = { version: 1 as const, identifier: "skill-picker", variant: "opencode", annotations }
    const url = new URL(
      feedbackIssueUrl({
        title: "Skill picker",
        identifier: "skill-picker",
        deepLink: annotationUrl("https://dev.opencode.ai/lab/catalog?screen=skill-picker", document),
        variant: "opencode",
        annotations,
        document,
      }),
    )
    const body = url.searchParams.get("body") ?? ""

    expect(body).toContain("## 1. Row 5, column 13")
    expect(body).toContain("This label needs more contrast.")
    expect(body).toContain("<summary>Annotation data</summary>")
    expect(body).toContain('"row": 4')
  })
})
