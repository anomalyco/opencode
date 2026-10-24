import { Effect, Option } from "effect"
import { execFileSync } from "node:child_process"
import { Octokit } from "@octokit/rest"
import * as core from "@actions/core"
import * as github from "@actions/github"
import { OpenCode } from "@opencode/client/promise"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { runNonInteractive } from "../../../run/run"

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
}

function gitSafe(args: string[], cwd: string): void {
  try { execFileSync("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] }) } catch {}
}

export default Runtime.handler(Commands.commands.github.commands.run, (input) =>
  Effect.gen(function* () {
    const server = yield* ServerConnection.resolve({ standalone: input.standalone })
    const eventStr = Option.getOrUndefined(input.event)
    let ctx: any
    if (eventStr) {
      ctx = JSON.parse(eventStr)
    } else if (process.env.GITHUB_REPOSITORY) {
      ctx = github.context
    } else {
      // Local run: build minimal context from git remote
      let remote = ""
      try { remote = git(["remote", "get-url", "origin"], process.cwd()) } catch {}
      const m = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/)
      ctx = { eventName: process.env["GITHUB_EVENT_NAME"] || "", repo: { owner: m?.[1] || "", repo: m?.[2] || "" }, payload: {}, actor: process.env["GITHUB_ACTOR"] }
    }
    const token = yield* Effect.promise(async () => {
      const t = Option.getOrUndefined(input.token) || process.env["GITHUB_TOKEN"] || process.env["TOKEN"]
      if (t) return t
      if (process.env["USE_GITHUB_TOKEN"] === "true") {
        const gt = process.env["GITHUB_TOKEN"]
        if (!gt) throw new Error("GITHUB_TOKEN required")
        return gt
      }
      if (!process.env["ACTIONS_ID_TOKEN_REQUEST_URL"]) {
        // Not in GitHub Actions; no OIDC available
        return undefined
      }
      try {
        const oidcBaseUrl = (process.env["OIDC_BASE_URL"] || "https://api.opencode.ai").replace(/\/+$/, "")
        const oidcToken = await core.getIDToken("opencode-github-action")
        const res = await fetch(`${oidcBaseUrl}/exchange_github_app_token`, {
          method: "POST",
          headers: { Authorization: `Bearer ${oidcToken}` },
        })
        if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
        const data = (await res.json()) as { token: string }
        return data.token
      } catch (e) {
        console.error("OIDC token exchange failed:", e)
        return undefined
      }
    })

    const eventName = ctx?.eventName || process.env["GITHUB_EVENT_NAME"] || ""
    const isRepoEvent = eventName === "schedule" || eventName === "workflow_dispatch"
    let issueNumber = ctx?.payload?.issue?.number ?? ctx?.payload?.pull_request?.number ?? ctx?.issue?.number
    let prPayload = ctx?.payload?.pull_request ?? (ctx?.payload?.issue?.pull_request ? ctx?.payload?.issue : null)

    // For issue_comment on a PR, fetch the PR to get head/base
    if (!prPayload?.head && issueNumber && token && ctx?.payload?.issue?.pull_request) {
      yield* Effect.promise(async () => {
        const octokit = new Octokit({ auth: token })
        try {
          const pr = await octokit.pulls.get({ owner: ctx.repo.owner, repo: ctx.repo.repo, pull_number: issueNumber })
          prPayload = pr.data
        } catch {}
      })
    }

    const isFork = !!prPayload?.head?.repo && (prPayload.head.repo.full_name !== (prPayload.base?.repo?.full_name ?? prPayload.base?.repo?.full_name))
    const owner = ctx?.repo?.owner ?? ctx?.repository?.owner?.login
    const repo = ctx?.repo?.repo ?? ctx?.repository?.name
    const actor = ctx?.actor
    const commentId = ctx?.payload?.comment?.id

    if (isRepoEvent && !process.env["PROMPT"]) {
      console.error("PROMPT is required for schedule and workflow_dispatch events")
      process.exitCode = 1
      return
    }

    // Permission check
    if (token && issueNumber && actor && !isRepoEvent) {
      yield* Effect.promise(async () => {
        const octokit = new Octokit({ auth: token })
        try {
          const perm = await octokit.repos.getCollaboratorPermissionLevel({ owner, repo, username: actor })
          if (!["admin", "write"].includes(perm.data.permission)) {
            throw new Error(`User ${actor} does not have write permissions`)
          }
        } catch (e: any) {
          console.error(e?.message || e)
          process.exitCode = 1
          throw e
        }
      })
    }

    // Add reaction
    if (token && commentId && !isRepoEvent) {
      yield* Effect.promise(async () => {
        const octokit = new Octokit({ auth: token })
        try {
          if (eventName === "pull_request_review_comment") {
            await octokit.reactions.createForPullRequestReviewComment({ owner, repo, comment_id: commentId, content: "eyes" })
          } else {
            await octokit.reactions.createForIssueComment({ owner, repo, comment_id: commentId, content: "eyes" })
          }
        } catch {}
      })
    }

    // Resolve prompt
    const commentBody: string = ctx?.payload?.comment?.body?.trim() || ""
    const mentions = (process.env["MENTIONS"] || "/opencode,/oc").split(",").map((m: string) => m.trim().toLowerCase()).filter(Boolean)
    let prompt = process.env["PROMPT"] || ""
    if (!prompt && !isRepoEvent) {
      if (mentions.some((m) => commentBody.toLowerCase() === m)) {
        prompt = "Summarize this thread"
      } else if (mentions.some((m) => commentBody.toLowerCase().includes(m))) {
        prompt = commentBody
      } else if (commentBody) {
        prompt = commentBody
      }
    }
    if (!prompt) prompt = "Summarize this repository"

    const cwd = process.cwd()

    // Checkout PR branch if applicable
    if (prPayload?.head?.ref) {
      yield* Effect.promise(async () => {
        try {
          if (isFork && prPayload.head.repo?.full_name) {
            try { git(["remote", "get-url", "fork"], cwd) } catch { git(["remote", "add", "fork", `https://github.com/${prPayload.head.repo.full_name}.git`], cwd) }
            git(["fetch", "fork", prPayload.head.ref], cwd)
            git(["checkout", "-B", `pr-${issueNumber}`, `fork/${prPayload.head.ref}`], cwd)
          } else {
            git(["fetch", "origin", prPayload.head.ref], cwd)
            git(["checkout", prPayload.head.ref], cwd)
          }
        } catch {}
      })
    }

    const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })

    // Create session with model
    const session = yield* Effect.promise(async () => {
      const modelStr = process.env["MODEL"]
      let baseModel = modelStr
      let variant: string | undefined
      if (modelStr && modelStr.includes("#")) {
        const parts = modelStr.split("#")
        baseModel = parts[0]
        variant = parts[1]
      }
      const modelParts = baseModel ? baseModel.split("/") : []
      const created = await client.session.create({ location: { directory: cwd }, model: baseModel ? { id: modelParts.slice(1).join("/"), providerID: modelParts[0], variant } : undefined, agent: process.env["AGENT"] || undefined, title: "github run" })
      return created
    })

    // Run the prompt
    yield* Effect.promise(async () => {
      await runNonInteractive({
        server,
        message: [prompt],
        continue: false,
        session: session.id,
        fork: false,
        model: process.env["MODEL"],
        agent: process.env["AGENT"] || undefined,
        format: "default",
        file: [],
        title: undefined,
        thinking: false,
        auto: true,
      })
    })

    // Read the model's answer from the session
    const answer = yield* Effect.promise(async () => {
      try {
        const msgs = await client.message.list({ sessionID: session.id, limit: 50 })
        const list = (msgs.data ?? msgs) as any[]
        const assistant = list.find((m: any) => m.type === "assistant")
        if (!assistant) return ""
        const parts = assistant.content ?? assistant.parts ?? []
        return parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n\n").trim()
      } catch {
        return ""
      }
    })

    // Post the model's answer as a comment
    yield* Effect.promise(async () => {
      if (!token || !issueNumber) return
      const octokit = new Octokit({ auth: token })
      try {
        await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body: answer || "opencode run completed." })
      } catch {}
    })

    // Remove reaction
    yield* Effect.promise(async () => {
      if (!token || !commentId || isRepoEvent) return
      const octokit = new Octokit({ auth: token })
      try {
        let reactions: any
        if (eventName === "pull_request_review_comment") {
          reactions = await octokit.reactions.listForPullRequestReviewComment({ owner, repo, comment_id: commentId, content: "eyes" })
        } else {
          reactions = await octokit.reactions.listForIssueComment({ owner, repo, comment_id: commentId, content: "eyes" })
        }
        const eyes = reactions.data.find((r: any) => r.user?.login === "opencode-agent[bot]")
        if (eyes) {
          if (eventName === "pull_request_review_comment") {
            await octokit.reactions.deleteForPullRequestComment({ owner, repo, comment_id: commentId, reaction_id: eyes.id })
          } else {
            await octokit.reactions.deleteForIssueComment({ owner, repo, comment_id: commentId, reaction_id: eyes.id })
          }
        }
      } catch {}
    })

    // Post-prompt git: commit and push if dirty
    yield* Effect.promise(async () => {
      const status = git(["status", "--porcelain"], cwd)
      if (!status) return
      const pushToken = token
      if (!pushToken) {
        console.log("Working tree changed but no token provided; skipping PR creation")
        return
      }
      // Save original extraheader BEFORE setting token
      let originalExtra: string | undefined
      try { originalExtra = git(["config", "--local", "--get", "http.https://github.com/.extraheader"], cwd) } catch {}

      // Configure git credentials (local only)
      const newCredentials = Buffer.from(`x-access-token:${pushToken}`, "utf8").toString("base64")
      gitSafe(["config", "--local", "http.https://github.com/.extraheader", `AUTHORIZATION: basic ${newCredentials}`], cwd)
      // Set identity only if missing
      try { git(["config", "--local", "user.name"], cwd) } catch { gitSafe(["config", "--local", "user.name", "opencode-agent[bot]"], cwd) }
      try { git(["config", "--local", "user.email"], cwd) } catch { gitSafe(["config", "--local", "user.email", "opencode-agent[bot]@users.noreply.github.com"], cwd) }

      try {
        const octokit = new Octokit({ auth: pushToken })
        let base = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
        if (base === "HEAD") {
          try {
            const repoInfo = await octokit.repos.get({ owner, repo })
            base = repoInfo.data.default_branch
          } catch {
            base = "main"
          }
        }
        const branch = `opencode/run-${Date.now()}`
        git(["checkout", "-b", branch], cwd)
        git(["add", "-A"], cwd)
        git(["commit", "-m", "opencode: automated changes"], cwd)
        if (isFork && prPayload) {
          const forkRepo = prPayload.head.repo.full_name
          const headRef = prPayload.head.ref
          try { git(["remote", "get-url", "fork"], cwd) } catch { git(["remote", "add", "fork", `https://github.com/${forkRepo}.git`], cwd) }
          git(["push", "fork", `HEAD:${headRef}`], cwd)
        } else if (prPayload) {
          git(["push", "origin", `HEAD:${prPayload.head.ref}`], cwd)
        } else {
          git(["push", "-u", "origin", branch], cwd)
          try {
            const pr = await octokit.pulls.create({ owner, repo, title: "opencode: automated changes", head: branch, base, body: "Automated changes produced by opencode github run." })
            console.log(`Created PR #${pr.data.number}: ${pr.data.html_url}`)
          } catch (e: any) {
            console.log(`PR creation failed: ${e?.message || e}`)
          }
        }
      } catch (e: any) {
        console.error(`Git operation failed: ${e?.message || e}`)
        process.exitCode = 1
      } finally {
        if (originalExtra) {
          gitSafe(["config", "--local", "http.https://github.com/.extraheader", originalExtra], cwd)
        } else {
          gitSafe(["config", "--local", "--unset-all", "http.https://github.com/.extraheader"], cwd)
        }
      }
    })

    void input
  }),
)