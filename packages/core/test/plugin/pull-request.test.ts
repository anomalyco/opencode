import { expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { PullRequestPlugin } from "@opencode/core/plugin/pull-request"
import { gitExecutable } from "@opencode/core/util/git-executable"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(AppProcess.node))
const head = "a".repeat(40)
const old = "b".repeat(40)
const url = "https://github.com/example/project/pull/12"

function snapshot(
  input: { status?: string; conclusion?: string; checksCommit?: string; incomplete?: boolean; legacy?: boolean } = {},
) {
  return {
    data: {
      node: {
        number: 12,
        title: "Improve parser",
        url,
        state: "OPEN",
        isDraft: true,
        headRefName: "parser",
        headRefOid: head,
        baseRefName: "dev",
        commits: {
          nodes: [
            {
              commit: {
                oid: input.checksCommit ?? head,
                statusCheckRollup: {
                  contexts: {
                    pageInfo: { hasNextPage: false },
                    nodes: input.legacy
                      ? [
                          {
                            __typename: "StatusContext",
                            context: "unit",
                            state: input.conclusion ?? "SUCCESS",
                            targetUrl: `${url}/checks`,
                          },
                        ]
                      : [
                          {
                            __typename: "CheckRun",
                            name: "unit",
                            status: input.status ?? "COMPLETED",
                            conclusion: input.conclusion ?? "SUCCESS",
                            detailsUrl: `${url}/checks`,
                          },
                        ],
                  },
                },
              },
            },
          ],
        },
        latestReviews: {
          pageInfo: { hasNextPage: input.incomplete ?? false },
          nodes: [{ author: { login: "reviewer" }, state: "APPROVED", commit: { oid: old }, url: `${url}#review-1` }],
        },
        reviewThreads: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              isResolved: false,
              isOutdated: true,
              path: "src/parser.ts",
              line: 8,
              comments: { nodes: [{ author: null, body: "Handle empty input", url: `${url}#discussion-1` }] },
            },
            { isResolved: true, isOutdated: false, path: "src/parser.ts", line: 2, comments: { nodes: [] } },
          ],
        },
      },
    },
  }
}

function result(stdout: string, exitCode = 0, stderr = ""): AppProcess.RunResult {
  return {
    command: "fixture",
    exitCode,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    stdoutTruncated: false,
    stderrTruncated: false,
  }
}

const fixture = Effect.fn(function* (responses: readonly (AppProcess.RunResult | AppProcess.AppProcessError)[]) {
  const processes = yield* AppProcess.Service
  const calls: { command: string; args: readonly string[]; cwd?: string }[] = []
  const fake = AppProcess.Service.of({
    ...processes,
    run: (command) => {
      if (command._tag !== "StandardCommand") return Effect.die("Unexpected pipe")
      calls.push({ command: command.command, args: command.args, cwd: command.options.cwd })
      const response = responses[calls.length - 1]
      if (!response) return Effect.die("Unexpected command")
      return response instanceof AppProcess.AppProcessError ? Effect.fail(response) : Effect.succeed(response)
    },
  })
  return { calls, read: PullRequestPlugin.read("/checkout").pipe(Effect.provideService(AppProcess.Service, fake)) }
})

const identity = result(JSON.stringify({ id: "PR_example", url }))
const git = (sha = head, branch = "parser") => result(`${sha}\n${branch}\n`)

it.effect("reads the selected checkout without writes and preserves each artifact's commit", () =>
  Effect.gen(function* () {
    const run = yield* fixture([git(old), identity, result(JSON.stringify(snapshot())), git(old)])
    const value = yield* run.read
    expect(value).toMatchObject({
      status: "available",
      branch: "parser",
      localHead: old,
      head,
      draft: true,
      incomplete: false,
      checksCommit: head,
      checks: [{ name: "unit", state: "success" }],
      reviews: [{ author: "reviewer", state: "APPROVED", commit: old }],
      threads: [{ path: "src/parser.ts", line: 8, outdated: true, author: "", body: "Handle empty input" }],
    })
    expect(run.calls.map((call) => [call.command, call.args.slice(0, 4), call.cwd])).toEqual([
      [gitExecutable(), ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"], "/checkout"],
      ["gh", ["pr", "view", "--json", "id,url"], "/checkout"],
      ["gh", ["api", "--hostname", "github.com", "graphql"], "/checkout"],
      [gitExecutable(), ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"], "/checkout"],
    ])
    expect(run.calls[2]?.args).toContain("id=PR_example")
  }),
)

for (const entry of [
  { status: "COMPLETED", conclusion: "FAILURE", expected: "failure" },
  { status: "IN_PROGRESS", conclusion: "SUCCESS", expected: "pending" },
  { status: "COMPLETED", conclusion: "NEUTRAL", expected: "neutral" },
  { status: "COMPLETED", conclusion: "NEW_CONCLUSION", expected: "unknown" },
] as const)
  it.effect(`does not call ${entry.status}/${entry.conclusion} passing`, () =>
    Effect.gen(function* () {
      const response = snapshot(entry)
      const run = yield* fixture([git(), identity, result(JSON.stringify(response)), git()])
      const value = yield* run.read
      expect(value.status === "available" && value.checks[0]?.state).toBe(entry.expected)
    }),
  )

it.effect("marks truncated connections and keeps the check commit distinct from the PR head", () =>
  Effect.gen(function* () {
    const response = snapshot({ incomplete: true, checksCommit: old })
    const run = yield* fixture([git(), identity, result(JSON.stringify(response)), git()])
    expect(yield* run.read).toMatchObject({ status: "available", head, checksCommit: old, incomplete: true })
  }),
)

it.effect("includes commit status contexts as well as check runs", () =>
  Effect.gen(function* () {
    const run = yield* fixture([
      git(),
      identity,
      result(JSON.stringify(snapshot({ legacy: true, conclusion: "ERROR" }))),
      git(),
    ])
    expect(yield* run.read).toMatchObject({ status: "available", checks: [{ name: "unit", state: "failure" }] })
  }),
)

for (const after of [git(old), git(head, "other"), result("", 128)]) {
  it.effect(`rejects a checkout change: ${after.stdout.toString("utf8").trim() || "missing HEAD"}`, () =>
    Effect.gen(function* () {
      const run = yield* fixture([git(), identity, result(JSON.stringify(snapshot())), after])
      expect(yield* run.read).toEqual({ status: "unavailable", reason: "changed" })
    }),
  )
}

for (const entry of [
  { responses: [result("", 128)], reason: "not_git" },
  { responses: [git(head, "HEAD")], reason: "detached" },
  { responses: [git(), result("", 1, "no pull requests found for branch parser")], reason: "no_pull_request" },
  { responses: [git(), result("", 4)], reason: "authentication" },
  { responses: [git(), result("", 1, "API unavailable")], reason: "request_failed" },
  {
    responses: [git(), new AppProcess.AppProcessError({ command: "gh", cause: new Error("ENOENT") })],
    reason: "request_failed",
  },
  { responses: [git(), identity, result("not json")], reason: "request_failed" },
  { responses: [git(), identity, result(JSON.stringify({ data: { node: null } }))], reason: "request_failed" },
  {
    responses: [git(), identity, { ...result(JSON.stringify(snapshot())), stdoutTruncated: true }],
    reason: "request_failed",
  },
] as const)
  it.effect(`reports ${entry.reason} instead of a passing empty result`, () =>
    Effect.gen(function* () {
      const run = yield* fixture(entry.responses)
      expect(yield* run.read).toEqual({ status: "unavailable", reason: entry.reason })
    }),
  )
