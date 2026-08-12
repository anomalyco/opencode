import type { Annotation, AnnotationDocument } from "./annotations"

interface FeedbackIssue {
  readonly title: string
  readonly identifier: string
  readonly deepLink: string
  readonly variant: string
  readonly annotations?: ReadonlyArray<Annotation>
  readonly document?: AnnotationDocument
}

export function feedbackIssueUrl(issue: FeedbackIssue) {
  const url = new URL("https://github.com/anomalyco/opencode/issues/new")
  url.searchParams.set("title", `[Catalog feedback] ${issue.title}`)
  url.searchParams.set("labels", "catalog,design-feedback")
  url.searchParams.set(
    "body",
    [
      ...(issue.annotations?.length
        ? issue.annotations.flatMap((annotation, index) => [
            `## ${index + 1}. Row ${annotation.row + 1}, column ${annotation.column + 1}`,
            "",
            annotation.note.trim(),
            "",
          ])
        : ["## Feedback", "", "<!-- What looks wrong, confusing, or could be improved? -->", ""]),
      "",
      "## Catalog state",
      "",
      `- Screen: \`${issue.identifier}\``,
      `- Theme: \`${issue.variant}\``,
      `- Link: ${issue.deepLink}`,
      ...(issue.document
        ? [
            "",
            "<details>",
            "<summary>Annotation data</summary>",
            "",
            "```json",
            JSON.stringify(issue.document, null, 2),
            "```",
            "</details>",
          ]
        : []),
    ].join("\n"),
  )
  return url.href
}
