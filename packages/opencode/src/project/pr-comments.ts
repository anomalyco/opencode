import { $ } from "bun"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { PR } from "./pr"

const log = Log.create({ service: "pr-comments" })

export namespace PrComments {
  export const ReviewComment = z
    .object({
      id: z.number(),
      author: z.string(),
      body: z.string(),
      path: z.string(),
      line: z.number().nullable(),
      diffHunk: z.string().optional(),
    })
    .meta({ ref: "ReviewComment" })
  export type ReviewComment = z.infer<typeof ReviewComment>

  export const ReviewThread = z
    .object({
      id: z.string(),
      isResolved: z.boolean(),
      path: z.string(),
      line: z.number().nullable(),
      comments: ReviewComment.array(),
    })
    .meta({ ref: "ReviewThread" })
  export type ReviewThread = z.infer<typeof ReviewThread>

  export const CommentsResponse = z
    .object({
      threads: ReviewThread.array(),
      promptBlock: z.string(),
      unresolvedCount: z.number(),
    })
    .meta({ ref: "PrCommentsResponse" })
  export type CommentsResponse = z.infer<typeof CommentsResponse>

  interface GqlReviewThreadsResponse {
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string }
            nodes?: Array<{
              id: string
              isResolved: boolean
              path: string
              line: number | null
              comments: {
                nodes: Array<{
                  databaseId: number
                  author: { login: string }
                  body: string
                  path: string
                  line: number | null
                  diffHunk?: string
                }>
              }
            }>
          }
        }
      }
    }
    errors?: Array<{ message?: string }>
  }

  function buildQuery(owner: string, name: string, prNumber: number, cursor: string | null): string {
    return `query($owner: String!, $name: String!, $prNumber: Int!, $cursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $prNumber) { reviewThreads(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id isResolved path line comments(first: 50) { nodes { databaseId author { login } body path line: originalLine diffHunk } } } } } } }`
  }

  export async function fetch(): Promise<CommentsResponse> {
    const info = await Vcs.info()
    if (!info.pr) {
      throw new PR.PrError("NO_PR", "No pull request found for current branch")
    }
    if (!info.github?.authenticated || !info.github.repo) {
      throw new PR.PrError("GH_NOT_AUTHENTICATED", "GitHub CLI is not authenticated")
    }

    const { owner, name } = info.github.repo
    const prNumber = info.pr.number
    const cwd = Instance.worktree

    const allThreads: ReviewThread[] = []
    let cursor: string | null = null

    do {
      const query = buildQuery(owner, name, prNumber, cursor)
      const args = [
        "gh",
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        "-F",
        `prNumber=${prNumber}`,
      ]
      if (cursor) {
        args.push("-f", `cursor=${cursor}`)
      }
      const cmd = await $`${args}`.quiet().nothrow().cwd(cwd)

      const stdout = cmd.stdout.toString()
      const stderr = cmd.stderr.toString()

      if (cmd.exitCode !== 0) {
        log.error("gh api graphql failed", { exitCode: cmd.exitCode, stderr })
        throw new PR.PrError(
          "COMMENTS_FETCH_FAILED",
          stderr.trim() || `gh api graphql exited with code ${cmd.exitCode}`,
        )
      }

      if (!stdout.trim()) {
        log.error("gh api graphql returned empty response")
        throw new PR.PrError("COMMENTS_FETCH_FAILED", "GitHub API returned empty response")
      }

      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(stdout)
      } catch {
        log.error("gh api graphql returned invalid JSON", { stdout: stdout.slice(0, 200) })
        throw new PR.PrError("COMMENTS_FETCH_FAILED", "GitHub API returned invalid response")
      }

      const response = parsed as GqlReviewThreadsResponse

      if (response.errors) {
        const msg = response.errors.map((e) => e.message).join("; ")
        log.error("GraphQL errors", { errors: response.errors })
        throw new PR.PrError("COMMENTS_FETCH_FAILED", msg || "GraphQL query failed")
      }

      const threads = response.data?.repository?.pullRequest?.reviewThreads
      if (!threads) break

      for (const node of threads.nodes ?? []) {
        allThreads.push({
          id: node.id,
          isResolved: node.isResolved,
          path: node.path ?? "",
          line: node.line,
          comments: (node.comments.nodes ?? []).map((c) => ({
            id: c.databaseId,
            author: c.author?.login ?? "unknown",
            body: c.body ?? "",
            path: c.path ?? "",
            line: c.line ?? null,
            diffHunk: c.diffHunk,
          })),
        })
      }

      cursor = threads.pageInfo?.hasNextPage ? (threads.pageInfo.endCursor ?? null) : null
    } while (cursor)

    const unresolved = allThreads.filter((t) => !t.isResolved)
    const promptBlock = formatPromptBlock(unresolved)

    return {
      threads: unresolved,
      promptBlock,
      unresolvedCount: unresolved.length,
    }
  }

  function formatPromptBlock(threads: ReviewThread[]): string {
    if (threads.length === 0) return "No unresolved review comments."

    const blocks = threads.map((thread) => {
      if (thread.comments.length === 0) return ""

      const lines = [`### File: ${thread.path}${thread.line ? ` (line ${thread.line})` : ""}`]
      for (const comment of thread.comments) {
        lines.push(`**@${comment.author}** (comment ID: ${comment.id}): ${comment.body}`)
        if (comment.diffHunk) {
          const contextLine = comment.diffHunk.split("\n").pop()
          if (contextLine) {
            lines.push(`> Code context: \`${contextLine.replace(/^[+-]/, "").trim()}\``)
          }
        }
      }
      return lines.join("\n")
    })

    return blocks.filter(Boolean).join("\n\n")
  }
}
