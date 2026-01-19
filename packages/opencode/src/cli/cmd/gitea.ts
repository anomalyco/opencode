import path from "path"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { ModelsDev } from "../../provider/models"
import { Instance } from "@/project/instance"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { Identifier } from "../../id/id"
import { Provider } from "../../provider/provider"
import { Bus } from "../../bus"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { $ } from "bun"
import { map, pipe, sortBy, values } from "remeda"
import { GiteaAdapter } from "../../git-platform/gitea/adapter"
import { ForgejoAdapter } from "../../git-platform/forgejo/adapter"
import { parseRemoteUrl, detectPlatform } from "../../git-platform/factory"
import type { Platform, Issue, PullRequest } from "../../git-platform/types"
import { extractResponseText } from "./github"

const AGENT_REACTION = "eyes"
const WORKFLOW_FILE = ".gitea/workflows/opencode.yml"

export const GiteaCommand = cmd({
  command: "gitea",
  describe: "manage Gitea/Forgejo agent",
  builder: (yargs) => yargs.command(GiteaInstallCommand).command(GiteaRunCommand).demandCommand(),
  async handler() {},
})

export const GiteaInstallCommand = cmd({
  command: "install",
  describe: "install the Gitea/Forgejo agent",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Install Gitea/Forgejo agent")

        const app = await getAppInfo()

        const providers = await ModelsDev.get().then((p) => {
          delete p["github-copilot"]
          return p
        })

        const provider = await promptProvider()
        const model = await promptModel()

        await addWorkflowFiles()
        printNextSteps()

        function printNextSteps() {
          prompts.outro(
            [
              "Next steps:",
              "",
              `    1. Commit the \`${WORKFLOW_FILE}\` file and push`,
              `    2. Add the following secrets in repo settings:`,
              "",
              ...providers[provider].env.map((e) => `       - ${e}`),
              "",
              "       - OPENCODE_GIT_TOKEN (your personal access token with repo scope)",
              "",
              "    3. Go to an issue and comment `/oc summarize` to see the agent in action",
            ].join("\n"),
          )
        }

        async function getAppInfo() {
          const project = Instance.project
          if (project.vcs !== "git") {
            prompts.log.error("Could not find git repository. Please run this command from a git repository.")
            throw new UI.CancelledError()
          }

          const info = (await $`git remote get-url origin`.quiet().nothrow().text()).trim()
          const parsed = parseRemoteUrl(info)
          if (!parsed) {
            prompts.log.error("Could not parse git remote URL.")
            throw new UI.CancelledError()
          }
          return { ...parsed, root: Instance.worktree }
        }

        async function promptProvider() {
          const priority: Record<string, number> = {
            opencode: 0,
            anthropic: 1,
            openai: 2,
            google: 3,
          }
          const provider = await prompts.select({
            message: "Select provider",
            maxItems: 8,
            options: pipe(
              providers,
              values(),
              sortBy(
                (x) => priority[x.id] ?? 99,
                (x) => x.name ?? x.id,
              ),
              map((x) => ({
                label: x.name,
                value: x.id,
                hint: priority[x.id] === 0 ? "recommended" : undefined,
              })),
            ),
          })

          if (prompts.isCancel(provider)) throw new UI.CancelledError()
          return provider
        }

        async function promptModel() {
          const providerData = providers[provider]!

          const model = await prompts.select({
            message: "Select model",
            maxItems: 8,
            options: pipe(
              providerData.models,
              values(),
              sortBy((x) => x.name ?? x.id),
              map((x) => ({
                label: x.name ?? x.id,
                value: x.id,
              })),
            ),
          })

          if (prompts.isCancel(model)) throw new UI.CancelledError()
          return model
        }

        async function addWorkflowFiles() {
          const envStr = providers[provider].env.map((e) => `\n          ${e}: \${{ secrets.${e} }}`).join("")

          await Bun.write(
            path.join(app.root, WORKFLOW_FILE),
            `name: opencode

on:
  issue_comment:
    types: [created]

jobs:
  opencode:
    if: |
      contains(github.event.comment.body, ' /oc') ||
      startsWith(github.event.comment.body, '/oc') ||
      contains(github.event.comment.body, ' /opencode') ||
      startsWith(github.event.comment.body, '/opencode')
    # Note: github.event context variables are compatible with Gitea/Forgejo via the act runner
    # Adjust runs-on and container to match your runner configuration
    runs-on: linux
    container: catthehacker/ubuntu:act-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          persist-credentials: false

      - name: Install Bun
        run: |
          curl -fsSL https://bun.sh/install | bash
          echo "$HOME/.bun/bin" >> $GITHUB_PATH

      - name: Install opencode
        run: ~/.bun/bin/bun install -g opencode-ai@latest

      - name: Run opencode
        env:
          MODEL: ${provider}/${model}
          OPENCODE_GIT_TOKEN: \${{ secrets.OPENCODE_GIT_TOKEN }}
          OPENCODE_GIT_URL: \${{ gitea.server_url }}${envStr}
        run: opencode gitea run`,
          )

          prompts.log.success(`Added workflow file: "${WORKFLOW_FILE}"`)
        }
      },
    })
  },
})

export const GiteaRunCommand = cmd({
  command: "run",
  describe: "run the Gitea/Forgejo agent",
  builder: (yargs) =>
    yargs
      .option("event", {
        type: "string",
        describe: "Gitea mock event JSON to run the agent for",
      })
      .option("token", {
        type: "string",
        describe: "Gitea personal access token",
      })
      .option("url", {
        type: "string",
        describe: "Gitea instance URL",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const token = args.token || process.env.OPENCODE_GIT_TOKEN || process.env.OPENCODE_BOT_TOKEN
      if (!token) {
        console.error("OPENCODE_GIT_TOKEN environment variable is not set")
        process.exit(1)
      }

      const baseUrl: string = args.url || process.env.OPENCODE_GIT_URL || ""
      if (!baseUrl) {
        console.error("OPENCODE_GIT_URL environment variable is not set")
        process.exit(1)
      }

      const event = args.event ? JSON.parse(args.event) : await getEventFromEnv()
      if (!event) {
        console.error("No event data found. Set GITEA_EVENT_PATH or provide --event")
        process.exit(1)
      }

      const { providerID, modelID } = normalizeModel()
      const botUsername = process.env.OPENCODE_BOT_USERNAME || "opencode-bot"

      const platform = await detectPlatform(baseUrl, token)
      const adapter =
        platform === "forgejo"
          ? new ForgejoAdapter({ baseUrl, token, botUsername })
          : new GiteaAdapter({ baseUrl, token, botUsername })

      const { owner, repo } = parseEventRepo(event)
      const issueNumber = event.issue?.number || event.pull_request?.number
      const actor = event.sender?.login || event.comment?.user?.login
      const commentId = event.comment?.id
      const isPR = !!event.pull_request || !!event.issue?.pull_request

      let session: { id: string; title: string; version: string }
      let exitCode = 0

      try {
        if (actor) {
          await assertPermissions(owner, repo, actor)
        }

        if (commentId) {
          await adapter.addReaction(owner, repo, commentId, AGENT_REACTION)
        }

        await adapter.configureGitAuth(token)

        const { userPrompt, dataPrompt } = await buildPrompt(event, isPR, owner, repo, issueNumber)

        session = await Session.create({
          permission: [{ permission: "question", action: "deny", pattern: "*" }],
        })
        subscribeSessionEvents(session)
        console.log("opencode session", session.id)

        if (isPR) {
          const pr = await adapter.getPullRequest(owner, repo, issueNumber)
          await handlePR(pr, userPrompt, dataPrompt, owner, repo)
        } else {
          await handleIssue(userPrompt, dataPrompt, owner, repo, issueNumber)
        }
      } catch (e: unknown) {
        exitCode = 1
        const msg = e instanceof Error ? e.message : String(e)
        console.error(msg)
        if (issueNumber) {
          await adapter.createIssueComment(owner, repo, issueNumber, `Error: ${msg}`)
        }
      } finally {
        await adapter.restoreGitConfig()
      }

      process.exit(exitCode)

      function normalizeModel() {
        const value = process.env.MODEL
        if (!value) throw new Error('Environment variable "MODEL" is not set')
        const { providerID, modelID } = Provider.parseModel(value)
        if (!providerID.length || !modelID.length)
          throw new Error(`Invalid model ${value}. Model must be in the format "provider/model".`)
        return { providerID, modelID }
      }

      async function getEventFromEnv(): Promise<unknown> {
        const eventPath = process.env.GITEA_EVENT_PATH || process.env.GITHUB_EVENT_PATH
        console.log("Looking for event file...")
        console.log(`  GITEA_EVENT_PATH: ${process.env.GITEA_EVENT_PATH || "(not set)"}`)
        console.log(`  GITHUB_EVENT_PATH: ${process.env.GITHUB_EVENT_PATH || "(not set)"}`)
        if (eventPath) {
          console.log(`  Reading event from: ${eventPath}`)
          try {
            const file = Bun.file(eventPath)
            if (await file.exists()) {
              const content = await file.text()
              return JSON.parse(content)
            }
            console.log(`  Event file does not exist at: ${eventPath}`)
            return null
          } catch (e) {
            console.log(`  Error reading event file: ${e}`)
            return null
          }
        }
        return null
      }

      function parseEventRepo(event: { repository?: { owner?: { login?: string }; name?: string } }) {
        const owner = event.repository?.owner?.login
        const repo = event.repository?.name
        if (!owner || !repo) throw new Error("Could not parse repository from event")
        return { owner, repo }
      }

      async function assertPermissions(owner: string, repo: string, username: string) {
        console.log(`Asserting permissions for user ${username}...`)
        const permission = await adapter.getCollaboratorPermission(owner, repo, username)
        console.log(`  permission: ${permission}`)
        if (!["admin", "write"].includes(permission)) {
          throw new Error(`User ${username} does not have write permissions`)
        }
      }

      async function buildPrompt(
        event: { comment?: { body?: string }; action?: string },
        isPR: boolean,
        owner: string,
        repo: string,
        issueNumber: number,
      ) {
        const customPrompt = process.env.PROMPT
        if (customPrompt) {
          return { userPrompt: customPrompt, dataPrompt: "" }
        }

        const mentions = (process.env.MENTIONS || "/opencode,/oc")
          .split(",")
          .map((m) => m.trim().toLowerCase())
          .filter(Boolean)

        const body = event.comment?.body?.trim() || ""
        const bodyLower = body.toLowerCase()

        let userPrompt: string
        if (mentions.some((m) => bodyLower === m)) {
          userPrompt = isPR ? "Review this pull request" : "Summarize this thread"
        } else if (mentions.some((m) => bodyLower.includes(m))) {
          userPrompt = body
        } else {
          throw new Error(`Comments must mention ${mentions.map((m) => "`" + m + "`").join(" or ")}`)
        }

        const dataPrompt = isPR
          ? await buildPRDataPrompt(owner, repo, issueNumber)
          : await buildIssueDataPrompt(owner, repo, issueNumber)

        return { userPrompt, dataPrompt }
      }

      async function buildIssueDataPrompt(owner: string, repo: string, number: number) {
        const issue = await adapter.getIssue(owner, repo, number)
        const comments = issue.comments
          .filter((c) => c.id !== commentId)
          .map((c) => `  - ${c.author.login} at ${c.createdAt}: ${c.body}`)

        return [
          "<gitea_action_context>",
          "You are running as a Gitea/Forgejo Action. Important:",
          "- Git push and PR creation are handled AUTOMATICALLY by the opencode infrastructure after your response",
          "- Do NOT include warnings about tokens or permissions",
          "- Focus only on the code changes and your analysis/response",
          "</gitea_action_context>",
          "",
          "Read the following data as context:",
          "<issue>",
          `Title: ${issue.title}`,
          `Body: ${issue.body}`,
          `Author: ${issue.author.login}`,
          `Created At: ${issue.createdAt}`,
          `State: ${issue.state}`,
          ...(comments.length > 0 ? ["<issue_comments>", ...comments, "</issue_comments>"] : []),
          "</issue>",
        ].join("\n")
      }

      async function buildPRDataPrompt(owner: string, repo: string, number: number) {
        const pr = await adapter.getPullRequest(owner, repo, number)
        const comments = pr.comments
          .filter((c) => c.id !== commentId)
          .map((c) => `- ${c.author.login} at ${c.createdAt}: ${c.body}`)

        const files = pr.files.map((f) => `- ${f.path} (${f.status}) +${f.additions}/-${f.deletions}`)

        return [
          "<gitea_action_context>",
          "You are running as a Gitea/Forgejo Action. Important:",
          "- Git push and PR creation are handled AUTOMATICALLY by the opencode infrastructure after your response",
          "- Do NOT include warnings about tokens or permissions",
          "- Focus only on the code changes and your analysis/response",
          "</gitea_action_context>",
          "",
          "Read the following data as context:",
          "<pull_request>",
          `Title: ${pr.title}`,
          `Body: ${pr.body}`,
          `Author: ${pr.author.login}`,
          `Created At: ${pr.createdAt}`,
          `Base Branch: ${pr.baseRef}`,
          `Head Branch: ${pr.headRef}`,
          `State: ${pr.state}`,
          `Additions: ${pr.additions}`,
          `Deletions: ${pr.deletions}`,
          `Total Commits: ${pr.commitCount}`,
          `Changed Files: ${pr.files.length} files`,
          ...(comments.length > 0 ? ["<pull_request_comments>", ...comments, "</pull_request_comments>"] : []),
          ...(files.length > 0 ? ["<pull_request_changed_files>", ...files, "</pull_request_changed_files>"] : []),
          "</pull_request>",
        ].join("\n")
      }

      function subscribeSessionEvents(session: { id: string }) {
        const TOOL: Record<string, [string, string]> = {
          todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
          todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
          bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
          edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
          glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
          grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
          list: ["List", UI.Style.TEXT_INFO_BOLD],
          read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
          write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
        }

        function printEvent(color: string, type: string, title: string) {
          UI.println(
            color + "|",
            UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
            "",
            UI.Style.TEXT_NORMAL + title,
          )
        }

        let text = ""
        Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
          if (evt.properties.part.sessionID !== session.id) return
          const part = evt.properties.part

          if (part.type === "tool" && part.state.status === "completed") {
            const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
            const title =
              part.state.title || Object.keys(part.state.input).length > 0
                ? JSON.stringify(part.state.input)
                : "Unknown"
            console.log()
            printEvent(color, tool, title)
          }

          if (part.type === "text") {
            text = part.text
            if (part.time?.end) {
              UI.empty()
              UI.println(UI.markdown(text))
              UI.empty()
              text = ""
            }
          }
        })
      }

      async function chat(message: string) {
        console.log("Sending message to opencode...")

        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          model: { providerID, modelID },
          parts: [{ id: Identifier.ascending("part"), type: "text", text: message }],
        })

        if (result.info.role === "assistant" && result.info.error) {
          console.error("Agent error:", result.info.error)
          const message = "message" in result.info.error ? result.info.error.message : ""
          throw new Error(
            `${result.info.error.name}: ${message}`,
          )
        }

        const text = extractResponseText(result.parts)
        if (text) return text

        console.log("Requesting summary from agent...")
        const summary = await SessionPrompt.prompt({
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          model: { providerID, modelID },
          tools: { "*": false },
          parts: [
            {
              id: Identifier.ascending("part"),
              type: "text",
              text: "Summarize the actions you did for the user in 1-2 sentences.",
            },
          ],
        })

        if (summary.info.role === "assistant" && summary.info.error) {
          const message = "message" in summary.info.error ? summary.info.error.message : ""
          throw new Error(
            `${summary.info.error.name}: ${message}`,
          )
        }

        const summaryText = extractResponseText(summary.parts)
        if (!summaryText) throw new Error("Failed to get summary from agent")
        return summaryText
      }

      async function summarize(response: string) {
        try {
          return await chat(`Summarize the following in less than 40 characters:\n\n${response}`)
        } catch {
          return "Agent response"
        }
      }

      async function handlePR(pr: PullRequest, userPrompt: string, dataPrompt: string, owner: string, repo: string) {
        const isSameRepo = pr.baseRepo.owner === pr.headRepo.owner && pr.baseRepo.repo === pr.headRepo.repo
        const instanceDomain = new URL(baseUrl).hostname

        if (isSameRepo) {
          await checkoutBranch(pr.headRef, pr.commitCount)
        } else {
          await checkoutForkBranch(pr)
        }

        const head = (await $`git rev-parse HEAD`).stdout.toString().trim()
        const response = await chat(`${userPrompt}\n\n${dataPrompt}`)
        const { dirty, uncommitted } = await branchIsDirty(head)

        if (dirty) {
          const summary = await summarize(response)
          if (!actor) throw new Error("Could not determine actor for commit")
          if (isSameRepo) {
            await pushToLocalBranch(summary, uncommitted, actor, instanceDomain)
          } else {
            await pushToForkBranch(summary, pr, uncommitted, actor, instanceDomain)
          }
        }

        await adapter.createIssueComment(owner, repo, pr.number, response)
        if (commentId) {
          await removeReaction(owner, repo, commentId)
        }
      }

      async function handleIssue(userPrompt: string, dataPrompt: string, owner: string, repo: string, number: number) {
        const repoData = await adapter.getRepository(owner, repo)
        const branch = generateBranchName("issue", number)
        const instanceDomain = new URL(baseUrl).hostname

        await $`git checkout -b ${branch}`
        const head = (await $`git rev-parse HEAD`).stdout.toString().trim()
        const response = await chat(`${userPrompt}\n\n${dataPrompt}`)
        const { dirty, uncommitted } = await branchIsDirty(head)

        if (dirty) {
          const summary = await summarize(response)
          if (!actor) throw new Error("Could not determine actor for commit")
          await pushToNewBranch(summary, branch, uncommitted, actor, instanceDomain)
          const pr = await adapter.createPullRequest({
            owner,
            repo,
            title: summary,
            body: `${response}\n\nCloses #${number}`,
            head: branch,
            base: repoData.defaultBranch,
          })
          await adapter.createIssueComment(owner, repo, number, `Created PR #${pr.number}`)
        } else {
          await adapter.createIssueComment(owner, repo, number, response)
        }

        if (commentId) {
          await removeReaction(owner, repo, commentId)
        }
      }

      async function checkoutBranch(branch: string, commitCount: number) {
        console.log("Checking out branch...")
        const depth = Math.max(commitCount || 1, 20)
        await $`git fetch origin --depth=${depth} ${branch}`
        await $`git checkout ${branch}`
      }

      async function checkoutForkBranch(pr: PullRequest) {
        console.log("Checking out fork branch...")
        const remoteBranch = pr.headRef
        const localBranch = generateBranchName("pr", pr.number)
        const depth = Math.max(pr.commitCount || 1, 20)
        const forkUrl = adapter.getRemoteUrl(pr.headRepo.owner, pr.headRepo.repo)

        await $`git remote add fork ${forkUrl}`
        await $`git fetch fork --depth=${depth} ${remoteBranch}`
        await $`git checkout -b ${localBranch} fork/${remoteBranch}`
      }

      function generateBranchName(type: "issue" | "pr", number: number) {
        const timestamp = new Date()
          .toISOString()
          .replace(/[:-]/g, "")
          .replace(/\.\d{3}Z/, "")
          .split("T")
          .join("")
        return `opencode/${type}${number}-${timestamp}`
      }

      async function branchIsDirty(originalHead: string) {
        const ret = await $`git status --porcelain`
        const status = ret.stdout.toString().trim()
        if (status.length > 0) {
          return { dirty: true, uncommitted: true }
        }
        const head = await $`git rev-parse HEAD`
        return {
          dirty: head.stdout.toString().trim() !== originalHead,
          uncommitted: false,
        }
      }

      async function pushToNewBranch(summary: string, branch: string, commit: boolean, coauthor: string, instanceDomain: string) {
        console.log("Pushing to new branch...")
        if (commit) {
          await $`git add .`
          await $`git commit -m "${summary}

Co-authored-by: ${coauthor} <${coauthor}@users.noreply.${instanceDomain}>"`
        }
        await $`git push -u origin ${branch}`
      }

      async function pushToLocalBranch(summary: string, commit: boolean, coauthor: string, instanceDomain: string) {
        console.log("Pushing to local branch...")
        if (commit) {
          await $`git add .`
          await $`git commit -m "${summary}

Co-authored-by: ${coauthor} <${coauthor}@users.noreply.${instanceDomain}>"`
        }
        await $`git push`
      }

      async function pushToForkBranch(summary: string, pr: PullRequest, commit: boolean, coauthor: string, instanceDomain: string) {
        console.log("Pushing to fork branch...")
        const remoteBranch = pr.headRef

        if (commit) {
          await $`git add .`
          await $`git commit -m "${summary}

Co-authored-by: ${coauthor} <${coauthor}@users.noreply.${instanceDomain}>"`
        }
        await $`git push fork HEAD:${remoteBranch}`
      }

      async function removeReaction(owner: string, repo: string, commentId: number) {
        console.log("Removing reaction...")
        const reactions = await adapter.listReactions(owner, repo, commentId)
        const eyesReaction = reactions.find((r) => r.user.login === botUsername && r.content === AGENT_REACTION)
        if (eyesReaction) {
          await adapter.removeReaction(owner, repo, commentId, eyesReaction.id)
        }
      }
    })
  },
})
