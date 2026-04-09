import path from "path"
import { Filesystem } from "../../util/filesystem"
import * as prompts from "@clack/prompts"
import { map, pipe, sortBy, values } from "remeda"
import * as core from "@actions/core"
import * as github from "@actions/github"
import type { Context } from "@actions/github/lib/context"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { ModelsDev } from "../../provider/models"
import { Instance } from "@/project/instance"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import type { SessionID } from "../../session/schema"
import { MessageID, PartID } from "../../session/schema"
import { Provider } from "../../provider/provider"
import type { ProviderID, ModelID } from "../../provider/schema"
import { Bus } from "../../bus"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { Git } from "@/git"
import { setTimeout as sleep } from "node:timers/promises"
import { Process } from "@/util/process"
import { GiteaForge } from "@/forge/gitea"
import { parseRemote } from "@/forge"

type PromptFile = {
  filename: string
  mime: string
  content: string
  start: number
  end: number
  replacement: string
}

type RepoRef = {
  number: number
  title: string
}

type CommentRef = {
  id: number
  body: string
  path?: string
  diff_hunk?: string
  line?: number | null
  original_line?: number | null
  position?: number | null
  commit_id?: string
  original_commit_id?: string
}

type IssueCommentPayload = {
  issue: RepoRef
  comment: CommentRef
  is_pull?: boolean
}

type IssuesPayload = {
  issue: RepoRef
}

type PullRequestReviewCommentPayload = {
  pull_request: RepoRef
  comment: CommentRef
}

type PullRequestPayload = {
  pull_request: RepoRef
}

type Payload =
  | IssueCommentPayload
  | IssuesPayload
  | PullRequestReviewCommentPayload
  | PullRequestPayload
  | Record<string, never>

const WORKFLOW_FILE = ".gitea/workflows/opencode.yml"
const USER_EVENTS = ["issue_comment", "pull_request_review_comment", "issues", "pull_request"] as const
const REPO_EVENTS = ["schedule", "workflow_dispatch"] as const
const SUPPORTED_EVENTS = [...USER_EVENTS, ...REPO_EVENTS] as const

type UserEvent = (typeof USER_EVENTS)[number]
type RepoEvent = (typeof REPO_EVENTS)[number]

export function extractResponseText(parts: MessageV2.Part[]): string | null {
  const text = parts.findLast((part) => part.type === "text")
  if (text) return text.text
  if (parts.length > 0) return null
  throw new Error("Failed to parse response: no parts returned")
}

export function formatPromptTooLargeError(files: { filename: string; content: string }[]): string {
  const details =
    files.length > 0
      ? `\n\nFiles in prompt:\n${files.map((file) => `  - ${file.filename} (${((file.content.length * 0.75) / 1024).toFixed(0)} KB)`).join("\n")}`
      : ""
  return `PROMPT_TOO_LARGE: The prompt exceeds the model's context limit.${details}`
}

export const GiteaCommand = cmd({
  command: "gitea",
  describe: "manage Gitea agent",
  builder: (yargs) => yargs.command(GiteaInstallCommand).command(GiteaRunCommand).demandCommand(),
  async handler() {},
})

export const GiteaInstallCommand = cmd({
  command: "install",
  describe: "install the Gitea agent",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Install Gitea agent")
        const app = await getAppInfo()
        const providers = await ModelsDev.get().then((item) => {
          delete item["github-copilot"]
          return item
        })
        const token = await promptToken()
        await verifyToken(token)
        const provider = await promptProvider()
        const model = await promptModel(provider)
        await addWorkflowFiles(provider, model)
        printNextSteps(provider)

        async function getAppInfo() {
          if (Instance.project.vcs !== "git") {
            prompts.log.error("Could not find git repository. Please run this command from a git repository.")
            throw new UI.CancelledError()
          }

          const url = (await Git.run(["remote", "get-url", "origin"], { cwd: Instance.worktree })).text().trim()
          const parsed = parseRemote(url)
          if (!parsed || parsed.platform !== "gitea") {
            prompts.log.error("Could not find a Gitea git remote. Please run this command from a Gitea repository.")
            throw new UI.CancelledError()
          }
          return { ...parsed, root: Instance.worktree }
        }

        async function promptToken() {
          const token = await prompts.password({
            message: "Enter a GITEA_TOKEN with repository access",
            validate(value) {
              if ((value ?? "").trim().length > 0) return
              return "GITEA_TOKEN is required"
            },
          })
          if (prompts.isCancel(token)) throw new UI.CancelledError()
          return token
        }

        async function verifyToken(token: string) {
          const s = prompts.spinner()
          s.start("Validating GITEA_TOKEN")
          const forge = new GiteaForge(app.host, app.owner, app.repo)
          forge.authenticate(token)
          try {
            await forge.fetchRepo()
            s.stop("Validated GITEA_TOKEN")
          } catch (err) {
            s.stop("Failed to validate GITEA_TOKEN")
            prompts.log.error(err instanceof Error ? err.message : String(err))
            throw new UI.CancelledError()
          }
        }

        async function promptProvider() {
          const rank: Record<string, number> = {
            opencode: 0,
            anthropic: 1,
            openai: 2,
            google: 3,
          }
          const value = await prompts.select({
            message: "Select provider",
            maxItems: 8,
            options: pipe(
              providers,
              values(),
              sortBy(
                (item) => rank[item.id] ?? 99,
                (item) => item.name ?? item.id,
              ),
              map((item) => ({
                label: item.name,
                value: item.id,
                hint: rank[item.id] === 0 ? "recommended" : undefined,
              })),
            ),
          })
          if (prompts.isCancel(value)) throw new UI.CancelledError()
          return value
        }

        async function promptModel(provider: string) {
          const info = providers[provider]!
          const value = await prompts.select({
            message: "Select model",
            maxItems: 8,
            options: pipe(
              info.models,
              values(),
              sortBy((item) => item.name ?? item.id),
              map((item) => ({
                label: item.name ?? item.id,
                value: item.id,
              })),
            ),
          })
          if (prompts.isCancel(value)) throw new UI.CancelledError()
          return value
        }

        async function addWorkflowFiles(provider: string, model: string) {
          const env = ["GITEA_TOKEN", ...providers[provider].env]
          const envText = `\n        env:${env.map((item) => `\n          ${item}: \${{ secrets.${item} }}`).join("")}`
          await Filesystem.write(
            path.join(app.root, WORKFLOW_FILE),
            `name: opencode

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  opencode:
    if: |
      contains(gitea.event.comment.body, ' /oc') ||
      startsWith(gitea.event.comment.body, '/oc') ||
      contains(gitea.event.comment.body, ' /opencode') ||
      startsWith(gitea.event.comment.body, '/opencode')
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Run opencode
        uses: anomalyco/opencode/gitea@latest${envText}
        with:
          model: ${provider}/${model}
`,
          )
          prompts.log.success(`Added workflow file: "${WORKFLOW_FILE}"`)
        }

        function printNextSteps(provider: string) {
          prompts.outro(
            [
              "Next steps:",
              "",
              `    1. Commit the \`${WORKFLOW_FILE}\` file and push`,
              `    2. Add the following secrets in repo settings (${app.owner}/${app.repo})`,
              "",
              "       - GITEA_TOKEN",
              ...providers[provider].env.map((item) => `       - ${item}`),
              "",
              "    3. Go to a Gitea issue and comment `/oc summarize` to see the agent in action",
            ].join("\n"),
          )
        }
      },
    })
  },
})

export const GiteaRunCommand = cmd({
  command: "run",
  describe: "run the Gitea agent",
  builder: (yargs) =>
    yargs
      .option("event", {
        type: "string",
        describe: "Gitea mock event to run the agent for",
      })
      .option("token", {
        type: "string",
        describe: "Gitea personal access token (for local testing)",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const isMock = Boolean(args.event || args.token)
      const context = isMock ? (JSON.parse(args.event!) as Context) : github.context
      if (!SUPPORTED_EVENTS.includes(context.eventName as (typeof SUPPORTED_EVENTS)[number])) {
        core.setFailed(`Unsupported event type: ${context.eventName}`)
        process.exit(1)
      }

      const isUserEvent = USER_EVENTS.includes(context.eventName as UserEvent)
      const isRepoEvent = REPO_EVENTS.includes(context.eventName as RepoEvent)
      const isCommentEvent = ["issue_comment", "pull_request_review_comment"].includes(context.eventName)
      const isIssuesEvent = context.eventName === "issues"
      const isScheduleEvent = context.eventName === "schedule"
      const isWorkflowDispatchEvent = context.eventName === "workflow_dispatch"
      const model = normalizeModel()
      const variant = process.env["VARIANT"] || undefined
      const runId = normalizeRunId()
      const share = normalizeShare()
      const token = normalizeToken()
      const payload = context.payload as Payload
      const issueEvent = isIssueCommentEvent(payload) ? payload : undefined
      const actor = isScheduleEvent ? undefined : context.actor
      const remote = await gitText(["remote", "get-url", "origin"])
      const parsed = parseRemote(remote)
      if (!parsed || parsed.platform !== "gitea") throw new Error("Could not find a Gitea git remote")
      const gitHost = parsed.host
      const host = normalizeHost(gitHost)
      const owner = parsed.owner
      const repo = parsed.repo
      const forge = new GiteaForge(host, owner, repo)
      forge.authenticate(token)
      const issueId = getIssueId(payload, context.eventName)
      const runUrl = `https://${gitHost}/${owner}/${repo}/actions/runs/${runId}`
      const shareBaseUrl = isMock ? "https://dev.opencode.ai" : "https://opencode.ai"
      const triggerCommentId = isCommentEvent ? getCommentId(payload) : undefined
      let gitConfig: string | undefined
      let session: { id: SessionID; title: string; version: string }
      let shareId: string | undefined
      let exitCode = 0

      try {
        const prompt = await getUserPrompt()
        gitConfig = await configureGit(token)
        if (isUserEvent) {
          await assertPermissions(actor)
          await addReaction()
        }
        const repoData = await forge.fetchRepo()
        session = await Session.create({
          permission: [
            {
              permission: "question",
              action: "deny",
              pattern: "*",
            },
          ],
        })
        subscribeSessionEvents(session)
        shareId = await (async () => {
          if (share === false) return
          if (!share && repoData.private) return
          await Session.share(session.id)
          return session.id.slice(-8)
        })()
        console.log("opencode session", session.id)

        if (isRepoEvent) {
          if (isWorkflowDispatchEvent && actor) {
            console.log(`Triggered by: ${actor}`)
          }
          const type = isWorkflowDispatchEvent ? "dispatch" : "schedule"
          const branch = await checkoutNewBranch(type)
          const head = await gitText(["rev-parse", "HEAD"])
          const response = await chat(session, model, variant, prompt.userPrompt, prompt.promptFiles)
          const dirty = await branchIsDirty(head, branch)
          if (dirty.switched) {
            console.log("Agent managed its own branch, skipping infrastructure push/PR")
            console.log("Response:", response)
            return
          }
          if (!dirty.dirty) {
            console.log("Response:", response)
            return
          }
          const summary = await summarize(session, model, variant, response, payload)
          await pushToNewBranch(summary, branch, dirty.uncommittedChanges, isScheduleEvent, actor, gitHost)
          const typeLabel = isWorkflowDispatchEvent ? "workflow_dispatch" : "scheduled workflow"
          const pr = await createPR(
            repoData.defaultBranch,
            branch,
            summary,
            `${response}\n\nTriggered by ${typeLabel}${footer()}`,
          )
          if (pr) {
            console.log(`Created PR #${pr}`)
            return
          }
          console.log("Skipped PR creation (no new commits)")
          return
        }

        if (
          context.eventName === "pull_request" ||
          context.eventName === "pull_request_review_comment" ||
          issueEvent?.is_pull === true
        ) {
          const pr = await forge.fetchPR(issueId!)
          const data = forge.buildPromptDataForPR(pr, triggerCommentId)
          const shared = pr.comments.some((item) => item.body.includes(`${shareBaseUrl}/s/${shareId}`))
          if (pr.headRepository === pr.baseRepository) {
            await checkoutLocalBranch(pr.headRefName, pr.commits.totalCount)
            const head = await gitText(["rev-parse", "HEAD"])
            const response = await chat(session, model, variant, `${prompt.userPrompt}\n\n${data}`, prompt.promptFiles)
            const dirty = await branchIsDirty(head, pr.headRefName)
            if (dirty.switched) {
              console.log("Agent managed its own branch, skipping infrastructure push")
            }
            if (dirty.dirty && !dirty.switched) {
              const summary = await summarize(session, model, variant, response, payload)
              await pushToLocalBranch(summary, dirty.uncommittedChanges, actor, gitHost)
            }
            await createComment(`${response}${footer(!shared)}`)
            await removeReaction()
            return
          }

          const branch = await checkoutForkBranch(pr.headRepository, pr.headRefName, pr.commits.totalCount)
          const head = await gitText(["rev-parse", "HEAD"])
          const response = await chat(session, model, variant, `${prompt.userPrompt}\n\n${data}`, prompt.promptFiles)
          const dirty = await branchIsDirty(head, branch)
          if (dirty.switched) {
            console.log("Agent managed its own branch, skipping infrastructure push")
          }
          if (dirty.dirty && !dirty.switched) {
            const summary = await summarize(session, model, variant, response, payload)
            await pushToForkBranch(summary, pr.headRefName, dirty.uncommittedChanges, actor, gitHost)
          }
          await createComment(`${response}${footer(!shared)}`)
          await removeReaction()
          return
        }

        const branch = await checkoutNewBranch("issue")
        const head = await gitText(["rev-parse", "HEAD"])
        const issue = await forge.fetchIssue(issueId!)
        const data = forge.buildPromptDataForIssue(issue, triggerCommentId)
        const response = await chat(session, model, variant, `${prompt.userPrompt}\n\n${data}`, prompt.promptFiles)
        const dirty = await branchIsDirty(head, branch)
        if (dirty.switched) {
          await createComment(`${response}${footer(true)}`)
          await removeReaction()
          return
        }
        if (!dirty.dirty) {
          await createComment(`${response}${footer(true)}`)
          await removeReaction()
          return
        }
        const summary = await summarize(session, model, variant, response, payload)
        await pushToNewBranch(summary, branch, dirty.uncommittedChanges, false, actor, gitHost)
        const pr = await createPR(
          repoData.defaultBranch,
          branch,
          summary,
          `${response}\n\nCloses #${issueId}${footer(true)}`,
        )
        if (pr) {
          await createComment(`Created PR #${pr}${footer(true)}`)
          await removeReaction()
          return
        }
        await createComment(`${response}${footer(true)}`)
        await removeReaction()
      } catch (err) {
        exitCode = 1
        const msg = errorText(err)
        console.error(msg)
        if (isUserEvent && issueId) {
          await createComment(`${msg}${footer()}`)
          await removeReaction()
        }
        core.setFailed(msg)
      } finally {
        await restoreGitConfig(gitConfig)
        await forge.revokeToken()
      }

      process.exit(exitCode)

      function normalizeModel() {
        const value = process.env["MODEL"]
        if (!value) throw new Error(`Environment variable "MODEL" is not set`)
        const parsed = Provider.parseModel(value)
        if (!parsed.providerID.length || !parsed.modelID.length) {
          throw new Error(`Invalid model ${value}. Model must be in the format "provider/model".`)
        }
        return parsed
      }

      function normalizeRunId() {
        const value = process.env["GITHUB_RUN_ID"]
        if (!value) throw new Error(`Environment variable "GITHUB_RUN_ID" is not set`)
        return value
      }

      function normalizeShare() {
        const value = process.env["SHARE"]
        if (!value) return undefined
        if (value === "true") return true
        if (value === "false") return false
        throw new Error(`Invalid share value: ${value}. Share must be a boolean.`)
      }

      function normalizeToken() {
        if (args.token) return args.token
        const value = process.env["GITEA_TOKEN"]
        if (!value) throw new Error(`Environment variable "GITEA_TOKEN" is not set`)
        return value
      }

      function normalizeHost(fallback: string) {
        const value = process.env["GITEA_API_URL"] || process.env["GITHUB_API_URL"]
        if (!value) return fallback
        return new URL(value).host
      }

      async function getUserPrompt() {
        const custom = process.env["PROMPT"]
        if (isRepoEvent || isIssuesEvent) {
          if (!custom) {
            const type = isRepoEvent ? "scheduled and workflow_dispatch" : "issues"
            throw new Error(`PROMPT input is required for ${type} events`)
          }
          return { userPrompt: custom, promptFiles: [] as PromptFile[] }
        }

        if (custom) {
          return { userPrompt: custom, promptFiles: [] as PromptFile[] }
        }

        const review = getReviewCommentContext(payload, context.eventName)
        const mentions = (process.env["MENTIONS"] || "/opencode,/oc")
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
        let prompt = (() => {
          if (!isCommentEvent) return "Review this pull request"
          const body = getCommentBody(payload).trim()
          const lower = body.toLowerCase()
          if (mentions.some((item) => lower === item)) {
            if (review) {
              return `Review this code change and suggest improvements for the commented lines:\n\nFile: ${review.file}\nLines: ${review.line}\n\n${review.diffHunk}`
            }
            return "Summarize this thread"
          }
          if (mentions.some((item) => lower.includes(item))) {
            if (review) {
              return `${body}\n\nContext: You are reviewing a comment on file "${review.file}" at line ${review.line}.\n\nDiff context:\n${review.diffHunk}`
            }
            return body
          }
          throw new Error(`Comments must mention ${mentions.map((item) => "`" + item + "`").join(" or ")}`)
        })()

        const files: PromptFile[] = []
        const md = prompt.matchAll(/!?\[.*?\]\((https?:\/\/[^)\s]+\/attachments\/[^)\s]+)\)/gi)
        const tag = prompt.matchAll(/<img .*?src="(https?:\/\/[^"\s]+\/attachments\/[^"\s]+)"\s*\/?>/gi)
        const matches = [...md, ...tag].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        let offset = 0
        for (const hit of matches) {
          const full = hit[0]
          const url = hit[1]
          const start = hit.index ?? 0
          const file = await downloadAttachment(url)
          if (!file) continue
          const replacement = `@${file.filename}`
          prompt = prompt.slice(0, start + offset) + replacement + prompt.slice(start + offset + full.length)
          offset += replacement.length - full.length
          files.push({
            filename: file.filename,
            mime: file.mime,
            content: file.content,
            start,
            end: start + replacement.length,
            replacement,
          })
        }
        return { userPrompt: prompt, promptFiles: files }
      }

      async function downloadAttachment(url: string) {
        if (new URL(url).host !== gitHost) return
        const item = parseAttachment(url)
        if (!item) return
        const res = await fetch(`https://${host}/api/v1/attachments/${item.uuid}`, {
          headers: {
            Authorization: `token ${token}`,
            Accept: "*/*",
          },
        }).catch(() => undefined)
        if (!res?.ok) return
        const name = item.name || fileName(res.headers.get("content-disposition")) || `attachment-${item.uuid}`
        const mime = res.headers.get("content-type") || "application/octet-stream"
        return {
          filename: name,
          mime,
          content: Buffer.from(await res.arrayBuffer()).toString("base64"),
        }
      }

      async function configureGit(token: string) {
        if (isMock) return undefined
        console.log("Configuring git...")
        const key = `http.https://${gitHost}/.extraheader`
        const ret = await gitStatus(["config", "--local", "--get", key])
        const saved = ret.exitCode === 0 ? ret.stdout.toString().trim() : undefined
        if (saved) {
          await gitRun(["config", "--local", "--unset-all", key])
        }
        const auth = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")
        await gitRun(["config", "--local", key, `AUTHORIZATION: basic ${auth}`])
        await gitRun(["config", "--global", "user.name", "opencode-agent"])
        await gitRun(["config", "--global", "user.email", `opencode-agent@${gitHost}`])
        return saved
      }

      async function restoreGitConfig(saved: string | undefined) {
        if (isMock) return
        const key = `http.https://${gitHost}/.extraheader`
        if (saved !== undefined) {
          await gitRun(["config", "--local", key, saved])
          return
        }
        const ret = await gitStatus(["config", "--local", "--get", key])
        if (ret.exitCode === 0) {
          await gitRun(["config", "--local", "--unset-all", key])
        }
      }

      async function assertPermissions(actor: string | undefined) {
        if (!actor) throw new Error("Could not determine actor")
        console.log(`Asserting permissions for user ${actor}...`)
        await forge.assertPermissions(actor)
      }

      async function addReaction() {
        if (!issueId) return
        console.log("Adding reaction...")
        await forge.addReaction(issueId, triggerCommentId)
      }

      async function removeReaction() {
        if (!issueId) return
        console.log("Removing reaction...")
        await forge.removeReaction(issueId, triggerCommentId)
      }

      async function createComment(body: string) {
        if (!issueId) return
        console.log("Creating comment...")
        await forge.createComment(body, issueId)
      }

      async function checkoutNewBranch(type: "issue" | "schedule" | "dispatch") {
        console.log("Checking out new branch...")
        const branch = generateBranchName(type, issueId)
        await gitRun(["checkout", "-b", branch])
        return branch
      }

      async function checkoutLocalBranch(branch: string, count: number) {
        console.log("Checking out local branch...")
        const depth = Math.max(count, 20)
        await gitRun(["fetch", "origin", `--depth=${depth}`, branch])
        await gitRun(["checkout", branch])
      }

      async function checkoutForkBranch(full: string, branch: string, count: number) {
        console.log("Checking out fork branch...")
        const local = generateBranchName("pr", issueId)
        const depth = Math.max(count, 20)
        const ret = await gitStatus(["remote", "get-url", "fork"])
        if (ret.exitCode === 0) {
          await gitRun(["remote", "remove", "fork"])
        }
        await gitRun(["remote", "add", "fork", `https://${gitHost}/${full}.git`])
        await gitRun(["fetch", "fork", `--depth=${depth}`, branch])
        await gitRun(["checkout", "-b", local, `fork/${branch}`])
        return local
      }

      async function pushToNewBranch(
        summary: string,
        branch: string,
        commit: boolean,
        scheduled: boolean,
        actor: string | undefined,
        host: string,
      ) {
        console.log("Pushing to new branch...")
        if (commit) {
          await gitRun(["add", "."])
          await commitChanges(summary, scheduled ? undefined : actor, host)
        }
        await gitRun(["push", "-u", "origin", branch])
      }

      async function pushToLocalBranch(summary: string, commit: boolean, actor: string | undefined, host: string) {
        console.log("Pushing to local branch...")
        if (commit) {
          await gitRun(["add", "."])
          await commitChanges(summary, actor, host)
        }
        await gitRun(["push"])
      }

      async function pushToForkBranch(
        summary: string,
        branch: string,
        commit: boolean,
        actor: string | undefined,
        host: string,
      ) {
        console.log("Pushing to fork branch...")
        if (commit) {
          await gitRun(["add", "."])
          await commitChanges(summary, actor, host)
        }
        await gitRun(["push", "fork", `HEAD:${branch}`])
      }

      async function createPR(base: string, branch: string, title: string, body: string) {
        console.log("Creating pull request...")
        try {
          const prs = await withRetry(() => forge.listOpenPRs({ head: branch, base }))
          if (prs.length > 0) {
            console.log(`PR #${prs[0].number} already exists for branch ${branch}`)
            return prs[0].number
          }
        } catch (err) {
          console.log(`Failed to check for existing PR: ${errorText(err)}`)
        }

        if (!(await hasNewCommits(base, branch))) {
          console.log(`No commits between ${base} and ${branch}, skipping PR creation`)
          return null
        }
        return withRetry(() => forge.createPR({ base, branch, title, body }))
      }

      function footer(image?: boolean) {
        const img = (() => {
          if (!shareId || !image) return ""
          const alt = encodeURIComponent(session.title.substring(0, 50))
          const title = Buffer.from(session.title.substring(0, 700), "utf8").toString("base64")
          return `<a href="${shareBaseUrl}/s/${shareId}"><img width="200" alt="${alt}" src="https://social-cards.sst.dev/opencode-share/${title}.png?model=${model.providerID}/${model.modelID}&version=${session.version}&id=${shareId}" /></a>\n`
        })()
        const shareUrl = shareId ? `[opencode session](${shareBaseUrl}/s/${shareId})&nbsp;&nbsp;|&nbsp;&nbsp;` : ""
        return `\n\n${img}${shareUrl}[gitea run](${runUrl})`
      }
    })
  },
})

function subscribeSessionEvents(session: { id: SessionID }) {
  const tool: Record<string, [string, string]> = {
    todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
    bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
    edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
    glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
    grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
    list: ["List", UI.Style.TEXT_INFO_BOLD],
    read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
    write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
    websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
  }

  function print(color: string, type: string, title: string) {
    UI.println(
      color + `|`,
      UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
      "",
      UI.Style.TEXT_NORMAL + title,
    )
  }

  let text = ""
  Bus.subscribe(MessageV2.Event.PartUpdated, (evt) => {
    if (evt.properties.part.sessionID !== session.id) return
    const part = evt.properties.part
    if (part.type === "tool" && part.state.status === "completed") {
      const info = tool[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
      const title =
        part.state.title || (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
      console.log()
      print(info[1], info[0], title)
    }
    if (part.type !== "text") return
    text = part.text
    if (!part.time?.end) return
    UI.empty()
    UI.println(UI.markdown(text))
    UI.empty()
    text = ""
  })
}

async function chat(
  session: { id: SessionID },
  model: { providerID: ProviderID; modelID: ModelID },
  variant: string | undefined,
  message: string,
  files: PromptFile[] = [],
) {
  console.log("Sending message to opencode...")
  const result = await SessionPrompt.prompt({
    sessionID: session.id,
    messageID: MessageID.ascending(),
    variant,
    model,
    parts: [
      {
        id: PartID.ascending(),
        type: "text",
        text: message,
      },
      ...files.flatMap((file) => [
        {
          id: PartID.ascending(),
          type: "file" as const,
          mime: file.mime,
          url: `data:${file.mime};base64,${file.content}`,
          filename: file.filename,
          source: {
            type: "file" as const,
            text: {
              value: file.replacement,
              start: file.start,
              end: file.end,
            },
            path: file.filename,
          },
        },
      ]),
    ],
  })
  if (result.info.role === "assistant" && result.info.error) {
    const err = result.info.error
    console.error("Agent error:", err)
    if (err.name === "ContextOverflowError") {
      throw new Error(formatPromptTooLargeError(files))
    }
    throw new Error(`${err.name}: ${err.data?.message || ""}`)
  }
  const text = extractResponseText(result.parts)
  if (text) return text
  console.log("Requesting summary from agent...")
  const summary = await SessionPrompt.prompt({
    sessionID: session.id,
    messageID: MessageID.ascending(),
    variant,
    model,
    tools: { "*": false },
    parts: [
      {
        id: PartID.ascending(),
        type: "text",
        text: "Summarize the actions (tool calls & reasoning) you did for the user in 1-2 sentences.",
      },
    ],
  })
  if (summary.info.role === "assistant" && summary.info.error) {
    const err = summary.info.error
    console.error("Summary agent error:", err)
    if (err.name === "ContextOverflowError") {
      throw new Error(formatPromptTooLargeError(files))
    }
    throw new Error(`${err.name}: ${err.data?.message || ""}`)
  }
  const textSummary = extractResponseText(summary.parts)
  if (!textSummary) throw new Error("Failed to get summary from agent")
  return textSummary
}

async function summarize(
  session: { id: SessionID },
  model: { providerID: ProviderID; modelID: ModelID },
  variant: string | undefined,
  response: string,
  payload: Payload,
) {
  try {
    return await chat(session, model, variant, `Summarize the following in less than 40 characters:\n\n${response}`)
  } catch {
    const issue = isIssueCommentEvent(payload) || isIssuesEvent(payload) ? payload.issue.title : undefined
    const pr = isPullRequestEvent(payload) || isReviewCommentEvent(payload) ? payload.pull_request.title : undefined
    return `Fix issue: ${issue || pr || "update"}`
  }
}

async function branchIsDirty(originalHead: string, expectedBranch: string) {
  console.log("Checking if branch is dirty...")
  const current = await gitText(["rev-parse", "--abbrev-ref", "HEAD"])
  if (current !== expectedBranch) {
    console.log(`Branch changed during chat: expected ${expectedBranch}, now on ${current}`)
    return { dirty: true, uncommittedChanges: false, switched: true }
  }
  const ret = await gitStatus(["status", "--porcelain"])
  const status = ret.stdout.toString().trim()
  if (status.length > 0) {
    return { dirty: true, uncommittedChanges: true, switched: false }
  }
  const head = await gitText(["rev-parse", "HEAD"])
  return {
    dirty: head !== originalHead,
    uncommittedChanges: false,
    switched: false,
  }
}

async function hasNewCommits(base: string, head: string) {
  const result = await gitStatus(["rev-list", "--count", `${base}..${head}`])
  if (result.exitCode === 0) {
    return parseInt(result.stdout.toString().trim()) > 0
  }
  console.log(`rev-list failed, fetching origin/${base}...`)
  await gitStatus(["fetch", "origin", base, "--depth=1"])
  const retry = await gitStatus(["rev-list", "--count", `origin/${base}..${head}`])
  if (retry.exitCode !== 0) return true
  return parseInt(retry.stdout.toString().trim()) > 0
}

function generateBranchName(type: "issue" | "pr" | "schedule" | "dispatch", issueId?: number) {
  const time = new Date()
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}Z/, "")
    .replace("T", "")
  if (type === "schedule" || type === "dispatch") {
    return `opencode/${type}-${crypto.randomUUID().slice(0, 6)}-${time}`
  }
  return `opencode/${type}${issueId}-${time}`
}

async function gitText(args: string[]) {
  const result = await Git.run(args, { cwd: Instance.worktree })
  if (result.exitCode !== 0) {
    throw new Process.RunFailedError(["git", ...args], result.exitCode, result.stdout, result.stderr)
  }
  return result.text().trim()
}

async function gitRun(args: string[]) {
  const result = await Git.run(args, { cwd: Instance.worktree })
  if (result.exitCode !== 0) {
    throw new Process.RunFailedError(["git", ...args], result.exitCode, result.stdout, result.stderr)
  }
  return result
}

function gitStatus(args: string[]) {
  return Git.run(args, { cwd: Instance.worktree })
}

async function commitChanges(summary: string, actor: string | undefined, host: string) {
  const args = ["commit", "-m", summary]
  if (actor) args.push("-m", `Co-authored-by: ${actor} <${actor}@${host}>`)
  await gitRun(args)
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 5000): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (retries > 0) {
      console.log(`Retrying after ${delayMs}ms...`)
      await sleep(delayMs)
      return withRetry(fn, retries - 1, delayMs)
    }
    throw err
  }
}

function parseAttachment(url: string) {
  const value = new URL(url)
  const parts = value.pathname.split("/").filter(Boolean)
  const idx = parts.indexOf("attachments")
  if (idx === -1) return null
  const uuid = parts[idx + 1]
  if (!uuid) return null
  const name = parts[idx + 2]
  return { uuid, name }
}

function fileName(value: string | null) {
  if (!value) return undefined
  const match = value.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i)
  if (!match) return undefined
  return decodeURIComponent(match[1].replace(/"/g, ""))
}

function getIssueId(payload: Payload, event: string) {
  if (REPO_EVENTS.includes(event as RepoEvent)) return undefined
  if (isIssueCommentEvent(payload) || isIssuesEvent(payload)) return payload.issue.number
  if (isPullRequestEvent(payload) || isReviewCommentEvent(payload)) return payload.pull_request.number
  return undefined
}

function getCommentId(payload: Payload) {
  if (isIssueCommentEvent(payload) || isReviewCommentEvent(payload)) return payload.comment.id
  return undefined
}

function getCommentBody(payload: Payload) {
  if (isIssueCommentEvent(payload) || isReviewCommentEvent(payload)) return payload.comment.body
  return ""
}

function getReviewCommentContext(payload: Payload, event: string) {
  if (event !== "pull_request_review_comment") return null
  if (!isReviewCommentEvent(payload)) return null
  return {
    file: payload.comment.path || "unknown",
    diffHunk: payload.comment.diff_hunk || "",
    line: payload.comment.line,
    originalLine: payload.comment.original_line,
    position: payload.comment.position,
    commitId: payload.comment.commit_id,
    originalCommitId: payload.comment.original_commit_id,
  }
}

function errorText(err: unknown) {
  if (err instanceof Process.RunFailedError) return err.stderr.toString()
  if (err instanceof Error) return err.message
  return String(err)
}

function isIssueCommentEvent(payload: Payload): payload is IssueCommentPayload {
  return "issue" in payload && "comment" in payload
}

function isIssuesEvent(payload: Payload): payload is IssuesPayload {
  return "issue" in payload && !("comment" in payload)
}

function isReviewCommentEvent(payload: Payload): payload is PullRequestReviewCommentPayload {
  return "pull_request" in payload && "comment" in payload
}

function isPullRequestEvent(payload: Payload): payload is PullRequestPayload {
  return "pull_request" in payload && !("comment" in payload)
}
