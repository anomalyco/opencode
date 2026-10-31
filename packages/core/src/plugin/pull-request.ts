export * as PullRequestPlugin from "./pull-request.js"

import { define } from "@opencode/plugin/effect/plugin"
import { PullRequest } from "@opencode/schema/pull-request"
import { AppProcess } from "@opencode/util/process"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/process"
import { Location } from "../location.js"
import { gitExecutable } from "../util/git-executable.js"
import query from "./pull-request.txt"

const Actor = Schema.NullOr(Schema.Struct({ login: Schema.String }))
const Page = Schema.Struct({ hasNextPage: Schema.Boolean })
const Check = Schema.Union([
  Schema.Struct({
    __typename: Schema.Literal("CheckRun"),
    name: Schema.String,
    status: Schema.String,
    conclusion: Schema.NullOr(Schema.String),
    detailsUrl: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    __typename: Schema.Literal("StatusContext"),
    context: Schema.String,
    state: Schema.String,
    targetUrl: Schema.NullOr(Schema.String),
  }),
])
const Response = Schema.Struct({
  data: Schema.Struct({
    node: Schema.Struct({
      number: PullRequest.Snapshot.fields.number,
      title: Schema.String,
      url: PullRequest.Link,
      state: PullRequest.Snapshot.fields.state,
      isDraft: Schema.Boolean,
      headRefName: Schema.String,
      headRefOid: Schema.String,
      baseRefName: Schema.String,
      commits: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            commit: Schema.Struct({
              oid: Schema.String,
              statusCheckRollup: Schema.NullOr(
                Schema.Struct({
                  contexts: Schema.Struct({ nodes: Schema.Array(Check), pageInfo: Page }),
                }),
              ),
            }),
          }),
        ),
      }),
      latestReviews: Schema.Struct({
        pageInfo: Page,
        nodes: Schema.Array(
          Schema.Struct({
            author: Actor,
            state: Schema.String,
            commit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
            url: PullRequest.Link,
          }),
        ),
      }),
      reviewThreads: Schema.Struct({
        pageInfo: Page,
        nodes: Schema.Array(
          Schema.Struct({
            isResolved: Schema.Boolean,
            isOutdated: Schema.Boolean,
            path: Schema.String,
            line: PullRequest.Thread.fields.line,
            comments: Schema.Struct({
              nodes: Schema.Array(Schema.Struct({ author: Actor, body: Schema.String, url: PullRequest.Link })),
            }),
          }),
        ),
      }),
    }),
  }),
})

export const Plugin = define({
  id: "opencode.pull-request",
  effect: Effect.fn("PullRequestPlugin")(function* (ctx) {
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    yield* ctx.rpc
      .register(PullRequest.Definition, {
        get: () => read(location.directory).pipe(Effect.provideService(AppProcess.Service, processes)),
      })
      .pipe(Effect.orDie)
  }),
})

export const read = Effect.fn("PullRequest.read")(
  function* (directory: string) {
    const processes = yield* AppProcess.Service
    const run = (command: string, args: string[]) =>
      processes.run(ChildProcess.make(command, args, { cwd: directory, stdin: "ignore" }), {
        timeout: "20 seconds",
        maxOutputBytes: 1024 * 1024,
        maxErrorBytes: 4096,
      })
    const before = yield* run(gitExecutable(), ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"])
    if (before.exitCode !== 0) return unavailable("not_git")
    const [localHead, branch] = before.stdout.toString("utf8").trim().split(/\r?\n/u)
    if (!localHead || !branch || branch === "HEAD") return unavailable("detached")

    const identity = yield* run("gh", ["pr", "view", "--json", "id,url"])
    if (identity.exitCode === 4) return unavailable("authentication")
    if (identity.exitCode !== 0) {
      return unavailable(
        /no pull requests? found/iu.test(identity.stderr.toString("utf8")) ? "no_pull_request" : "request_failed",
      )
    }
    const target = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(
        Schema.Struct({
          id: Schema.String,
          url: PullRequest.Link,
        }),
      ),
    )(identity.stdout.toString("utf8"))
    if (!URL.canParse(target.url)) return unavailable("request_failed")
    const response = yield* run("gh", [
      "api",
      "--hostname",
      new URL(target.url).hostname,
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `id=${target.id}`,
    ])
    if (response.exitCode === 4) return unavailable("authentication")
    if (response.exitCode !== 0 || response.stdoutTruncated) return unavailable("request_failed")
    const data = (yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Response))(response.stdout.toString("utf8")))
      .data.node
    const after = yield* run(gitExecutable(), ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"])
    if (after.exitCode !== 0 || !before.stdout.equals(after.stdout) || data.headRefName !== branch)
      return unavailable("changed")
    const commit = data.commits.nodes[0]?.commit
    const checks = commit?.statusCheckRollup?.contexts

    return {
      status: "available",
      branch,
      localHead,
      number: data.number,
      title: data.title,
      url: data.url,
      state: data.state,
      draft: data.isDraft,
      head: data.headRefOid,
      base: data.baseRefName,
      checksCommit: commit?.oid ?? null,
      checks: (checks?.nodes ?? []).map((check) => ({
        name: check.__typename === "CheckRun" ? check.name : check.context,
        state: checkState(
          check.__typename === "CheckRun" ? (check.status === "COMPLETED" ? check.conclusion : "PENDING") : check.state,
        ),
        url: safeLink(check.__typename === "CheckRun" ? check.detailsUrl : check.targetUrl),
      })),
      reviews: data.latestReviews.nodes.map((review) => ({
        author: review.author?.login ?? "",
        state: review.state,
        commit: review.commit?.oid ?? null,
        url: review.url,
      })),
      threads: data.reviewThreads.nodes
        .filter((thread) => !thread.isResolved)
        .flatMap((thread) => {
          const comment = thread.comments.nodes[0]
          return comment
            ? [
                {
                  path: thread.path,
                  line: thread.line,
                  outdated: thread.isOutdated,
                  author: comment.author?.login ?? "",
                  body: comment.body,
                  url: comment.url,
                },
              ]
            : []
        }),
      incomplete:
        !!checks?.pageInfo.hasNextPage ||
        data.latestReviews.pageInfo.hasNextPage ||
        data.reviewThreads.pageInfo.hasNextPage,
    } satisfies PullRequest.Snapshot
  },
  Effect.catch((error) =>
    Effect.logDebug("pull request read failed", { error: error._tag }).pipe(Effect.as(unavailable("request_failed"))),
  ),
)

function unavailable(reason: PullRequest.Unavailable["reason"]): PullRequest.Unavailable {
  return { status: "unavailable", reason }
}

function safeLink(value: string | null) {
  return value && /^https?:\/\/\S+$/u.test(value) ? value : undefined
}

function checkState(value: string | null): PullRequest.Check["state"] {
  if (value === "SUCCESS") return "success"
  if (value === "PENDING" || value === "EXPECTED") return "pending"
  if (value === "NEUTRAL" || value === "SKIPPED") return "neutral"
  if (
    ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"].includes(value ?? "")
  )
    return "failure"
  return "unknown"
}
