import type { PullRequest } from "@opencode/schema/pull-request"

export function pullRequest(input: Partial<PullRequest.Snapshot> = {}): PullRequest.Snapshot {
  const head = "a".repeat(40)
  const old = "b".repeat(40)
  const url = "https://github.com/example/project/pull/12"

  return {
    status: "available",
    number: 12,
    title: "Improve parser",
    url,
    state: "OPEN",
    draft: true,
    branch: "parser",
    base: "dev",
    localHead: old,
    head,
    checksCommit: head,
    checks: [{ name: "unit tests", state: "success", url: `${url}/checks` }],
    reviews: [{ author: "reviewer", state: "APPROVED", commit: old, url: `${url}#review-1` }],
    threads: [
      {
        path: "src/parser.ts",
        line: 8,
        outdated: true,
        author: "reviewer",
        body: "Handle empty input",
        url: `${url}#discussion-1`,
      },
    ],
    incomplete: false,
    ...input,
  }
}
