interface FeedbackIssue {
  readonly title: string
  readonly identifier: string
  readonly deepLink: string
  readonly variant: string
}

export function feedbackIssueUrl(issue: FeedbackIssue) {
  const url = new URL("https://github.com/anomalyco/opencode/issues/new")
  url.searchParams.set("title", `[Catalog feedback] ${issue.title}`)
  url.searchParams.set("labels", "catalog,design-feedback")
  url.searchParams.set("body", [
    "## Feedback",
    "",
    "<!-- What looks wrong, confusing, or could be improved? -->",
    "",
    "## Catalog state",
    "",
    `- Screen: \`${issue.identifier}\``,
    `- Theme: \`${issue.variant}\``,
    `- Link: ${issue.deepLink}`,
  ].join("\n"))
  return url.href
}
