import { $ } from "bun"
import { generateObject, streamObject, type ModelMessage } from "ai"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Auth } from "@/auth"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "@/session/system"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import { Instance } from "./instance"
import { Vcs } from "./vcs"

const log = Log.create({ service: "pr" })

export namespace PR {
  export const ErrorCode = z.enum([
    "GH_NOT_INSTALLED",
    "GH_NOT_AUTHENTICATED",
    "NO_REPO",
    "NO_PR",
    "CREATE_FAILED",
    "MERGE_FAILED",
    "DELETE_BRANCH_FAILED",
    "COMMENTS_FETCH_FAILED",
    "READY_FAILED",
    "DRAFT_FAILED",
  ])
  export type ErrorCode = z.infer<typeof ErrorCode>

  export const PrError = NamedError.create("PrError", z.object({ code: ErrorCode, message: z.string() }))
  export type PrError = InstanceType<typeof PrError>

  export const CreateInput = z
    .object({
      title: z.string().min(1),
      body: z.string(),
      base: z.string().optional(),
      draft: z.boolean().optional(),
    })
    .meta({ ref: "PrCreateInput" })
  export type CreateInput = z.infer<typeof CreateInput>

  export const MergeInput = z
    .object({
      strategy: z.enum(["merge", "squash", "rebase"]).optional(),
      deleteBranch: z.boolean().optional(),
    })
    .meta({ ref: "PrMergeInput" })
  export type MergeInput = z.infer<typeof MergeInput>

  export const DeleteBranchInput = z
    .object({
      branch: z.string().regex(/^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/, "Invalid branch name"),
    })
    .meta({ ref: "PrDeleteBranchInput" })
  export type DeleteBranchInput = z.infer<typeof DeleteBranchInput>

  export const ReadyInput = z.object({}).meta({ ref: "PrReadyInput" })
  export type ReadyInput = z.infer<typeof ReadyInput>

  export const DraftInput = z
    .object({
      base: z.string().optional(),
    })
    .meta({ ref: "PrDraftInput" })
  export type DraftInput = z.infer<typeof DraftInput>

  export const DraftOutput = z
    .object({
      title: z.string().min(1),
      body: z.string().min(1),
    })
    .meta({ ref: "PrDraftOutput" })
  export type DraftOutput = z.infer<typeof DraftOutput>

  export const PrErrorResponse = PrError.Schema

  const DraftSchema = z.object({
    title: z.string(),
    body: z.string(),
  })

  function fallbackTitle(branch: string) {
    return branch
      .split("/")
      .at(-1)
      ?.replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || "Update branch"
  }

  function fallbackBody(title: string) {
    return `## Summary
- ${title}

## Testing
- Not run`
  }

  function cleanDraftTitle(title: string, branch: string) {
    const line = title
      .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    const next = line?.replace(/[.]+$/g, "").trim()
    if (!next) return fallbackTitle(branch)
    return next.length > 100 ? next.slice(0, 97).trimEnd() + "..." : next
  }

  function cleanDraftBody(body: string, title: string) {
    const next = body.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()
    if (!next) return fallbackBody(title)
    return next
  }

  async function selectDraftModel() {
    const defaultModel = await Provider.defaultModel()
    return (
      (await Provider.getSmallModel(defaultModel.providerID).catch(() => undefined)) ??
      (await Provider.getModel(defaultModel.providerID, defaultModel.modelID))
    )
  }

  async function generateDraftObject(input: { branch: string; base: string; commits: string; diffStat: string; diffPatch: string }) {
    const model = await selectDraftModel()
    const language = await Provider.getLanguage(model)
    const system = [
      [
        "You write GitHub pull request drafts.",
        "Return a JSON object with keys: title, body.",
        "Rules:",
        "- title must be concise, specific, and written for a pull request",
        "- body must be markdown",
        "- body must include headings '## Summary' and '## Testing'",
        "- under Summary, use short bullet points",
        "- under Testing, use bullet points with concrete checks or 'Not run'",
        "- do not invent requirements, screenshots, or test results",
      ].join("\n"),
    ]
    await Plugin.trigger("experimental.chat.system.transform", { model }, { system })

    const prompt = [
      `Head branch: ${input.branch}`,
      `Base branch: ${input.base}`,
      "",
      "Commits:",
      input.commits || "(none)",
      "",
      "Diff stat:",
      input.diffStat || "(none)",
      "",
      "Diff patch:",
      input.diffPatch || "(none)",
    ].join("\n")

    const messages: ModelMessage[] = [
      ...system.map((content) => ({
        role: "system" as const,
        content,
      })),
      {
        role: "user",
        content: prompt,
      },
    ]

    const isCodex = model.providerID === "openai" && (await Auth.get(model.providerID))?.type === "oauth"
    const params = {
      model: language,
      schema: DraftSchema,
      temperature: 0.2,
      messages,
    } satisfies Parameters<typeof generateObject>[0]

    if (isCodex) {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          instructions: SystemPrompt.instructions(),
          store: false,
        }),
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return await result.object
    }

    const result = await generateObject(params)
    return result.object
  }

  async function fetchUnresolvedCommentCount(
    owner: string,
    name: string,
    prNumber: number,
  ): Promise<number | undefined> {
    const cwd = Instance.worktree
    const query = `query($owner: String!, $name: String!, $prNumber: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $prNumber) { reviewThreads(first: 100) { nodes { isResolved } } } } }`
    const result = await withTimeout(
      $`gh api graphql -f query=${query} -f owner=${owner} -f name=${name} -F prNumber=${prNumber}`
        .quiet()
        .nothrow()
        .cwd(cwd)
        .text()
        .catch(() => ""),
      30_000,
    )
    try {
      const parsed = JSON.parse(result)
      const threads = parsed?.data?.repository?.pullRequest?.reviewThreads?.nodes
      if (!Array.isArray(threads)) return undefined
      return threads.filter((t: { isResolved: boolean }) => !t.isResolved).length
    } catch (e) {
      log.warn("fetchUnresolvedCommentCount failed", { error: e })
      return undefined
    }
  }

  export async function fetchForBranch(repo?: { owner: string; name: string }): Promise<Vcs.PrInfo | undefined> {
    const cwd = Instance.worktree
    try {
      const cmd = await withTimeout(
        $`gh pr view --json number,url,title,state,headRefName,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup`
          .quiet()
          .nothrow()
          .cwd(cwd),
        30_000,
      )
      if (cmd.exitCode !== 0) {
        log.warn("gh pr view failed", { stderr: cmd.stderr.toString().trim() })
        return undefined
      }
      const result = cmd.stdout.toString().trim()
      if (!result) {
        return undefined
      }
      const parsed = JSON.parse(result)
      if (!parsed.number) return undefined

      let checksState: "SUCCESS" | "FAILURE" | "PENDING" | null = null
      let checksUrl: string | undefined
      let checksSummary: { total: number; passed: number; failed: number; pending: number; skipped: number } | undefined
      if (parsed.statusCheckRollup && Array.isArray(parsed.statusCheckRollup)) {
        const checks = parsed.statusCheckRollup as Array<{
          __typename?: string
          conclusion?: string
          status?: string
          state?: string
          detailsUrl?: string
        }>
        if (checks.length > 0) {
          checksUrl = parsed.url ? `${parsed.url}/checks` : checks[0]?.detailsUrl?.replace(/\/runs\/.*/, "")
          // StatusContext entries (e.g. CodeRabbit) use `state` instead of `conclusion`/`status`
          const isSuccess = (c: (typeof checks)[0]) =>
            c.conclusion === "SUCCESS" || c.conclusion === "success" || c.state === "SUCCESS" || c.state === "success"
          const isFailure = (c: (typeof checks)[0]) =>
            c.conclusion === "FAILURE" ||
            c.conclusion === "failure" ||
            c.state === "FAILURE" ||
            c.state === "failure" ||
            c.state === "ERROR" ||
            c.state === "error"
          const isSkipped = (c: (typeof checks)[0]) =>
            c.conclusion === "SKIPPED" ||
            c.conclusion === "skipped" ||
            c.conclusion === "NEUTRAL" ||
            c.conclusion === "neutral"
          const failed = checks.filter(isFailure).length
          const passed = checks.filter(isSuccess).length
          const skipped = checks.filter(isSkipped).length
          const total = checks.length
          const pending = total - passed - failed - skipped
          checksSummary = { total, passed, failed, pending, skipped }
          if (failed > 0) checksState = "FAILURE"
          else if (pending === 0) checksState = "SUCCESS"
          else checksState = "PENDING"
        }
      }

      const stateMap: Record<string, "OPEN" | "CLOSED" | "MERGED"> = {
        OPEN: "OPEN",
        CLOSED: "CLOSED",
        MERGED: "MERGED",
      }

      const mergeableMap: Record<string, "MERGEABLE" | "CONFLICTING" | "UNKNOWN"> = {
        MERGEABLE: "MERGEABLE",
        CONFLICTING: "CONFLICTING",
        UNKNOWN: "UNKNOWN",
      }

      const pr: Vcs.PrInfo = {
        number: parsed.number,
        url: parsed.url,
        title: parsed.title,
        state: stateMap[parsed.state] ?? "OPEN",
        headRefName: parsed.headRefName,
        baseRefName: parsed.baseRefName,
        isDraft: parsed.isDraft ?? false,
        mergeable: mergeableMap[parsed.mergeable] ?? "UNKNOWN",
        reviewDecision: parsed.reviewDecision || null,
        checksState,
        checksUrl,
        checksSummary,
      }

      // Fetch unresolved comment count via lightweight GraphQL query
      if (repo) {
        pr.unresolvedCommentCount = await fetchUnresolvedCommentCount(repo.owner, repo.name, pr.number)
      }

      return pr
    } catch (e) {
      log.warn("fetchForBranch failed", { error: e })
      return undefined
    }
  }

  function sanitizeOutput(output: string): string {
    return output.replace(/(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9_]+/g, "<redacted>").slice(0, 500)
  }

  async function ensureGithub() {
    const info = await Vcs.info()
    const github = info.github
    if (!github?.available) {
      throw new PrError({ code: "GH_NOT_INSTALLED", message: "GitHub CLI (gh) is not installed" })
    }
    if (!github.authenticated) {
      throw new PrError({ code: "GH_NOT_AUTHENTICATED", message: "Run `gh auth login` to authenticate" })
    }
    return { info, github: github as Vcs.GithubCapability & { available: true; authenticated: true } }
  }

  export async function get(): Promise<Vcs.PrInfo | undefined> {
    const info = await Vcs.info()
    return info.pr
  }

  export async function draft(input: DraftInput): Promise<DraftOutput> {
    await Vcs.refresh()
    const info = await Vcs.info()
    const branch = info.branch
    if (!branch) {
      throw new PrError({ code: "DRAFT_FAILED", message: "No current branch found" })
    }

    const base = input.base ?? info.defaultBranch ?? "main"
    const cwd = Instance.worktree

    const [commits, diffStat, diffPatch] = await Promise.all([
      withTimeout(
        $`git log --oneline ${base}..HEAD`
          .quiet()
          .nothrow()
          .cwd(cwd)
          .text()
          .catch(() => ""),
        30_000,
      ),
      withTimeout(
        $`git diff --stat ${base}...HEAD`
          .quiet()
          .nothrow()
          .cwd(cwd)
          .text()
          .catch(() => ""),
        30_000,
      ),
      withTimeout(
        $`git diff --minimal ${base}...HEAD`
          .quiet()
          .nothrow()
          .cwd(cwd)
          .text()
          .catch(() => ""),
        30_000,
      ),
    ])

    try {
      const generated = await generateDraftObject({
        branch,
        base,
        commits: commits.trim().slice(0, 20_000),
        diffStat: diffStat.trim().slice(0, 20_000),
        diffPatch: diffPatch.trim().slice(0, 60_000),
      })
      const title = cleanDraftTitle(generated.title, branch)
      const body = cleanDraftBody(generated.body, title)
      return { title, body }
    } catch (e) {
      log.error("pr draft failed", { error: e })
      throw new PrError({ code: "DRAFT_FAILED", message: "Failed to generate pull request draft" })
    }
  }

  export async function create(input: CreateInput): Promise<Vcs.PrInfo> {
    await Vcs.refresh()
    const { info } = await ensureGithub()
    const cwd = Instance.worktree
    const branch = info.branch

    if (info.pr) {
      return info.pr
    }

    if (!branch) {
      throw new PrError({ code: "CREATE_FAILED", message: "No current branch found" })
    }

    const remote = await Vcs.resolvePushRemote(branch)
    if (!remote) {
      throw new PrError({ code: "CREATE_FAILED", message: "No remote configured for current branch" })
    }

    const push = await $`git push -u ${remote} HEAD`.quiet().nothrow().cwd(cwd)
    if (push.exitCode !== 0) {
      const errorOutput =
        push.stderr?.toString().trim() || push.stdout?.toString().trim() || "Failed to push branch automatically"
      log.error("push failed", { output: errorOutput })
      throw new PrError({ code: "CREATE_FAILED", message: sanitizeOutput(errorOutput) })
    }

    if (input.base) {
      const branches = info.branches ?? (await Vcs.fetchBranches())
      if (!branches.includes(input.base)) {
        throw new PrError({ code: "CREATE_FAILED", message: `Base branch '${input.base}' does not exist` })
      }
    }

    const args = ["gh", "pr", "create", "--title", input.title]
    args.push("--body", input.body)
    if (input.base) args.push("--base", input.base)
    if (input.draft) args.push("--draft")

    const cmd = await withTimeout(
      $`${args}`
        .quiet()
        .nothrow()
        .cwd(cwd)
        .catch((e: unknown) => ({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from(String(e)) })),
      60_000,
    )

    const result = cmd.stdout.toString()
    const errorOut = cmd.stderr.toString()

    if (cmd.exitCode !== 0 || !result.trim()) {
      log.error("pr create failed", { stdout: result, stderr: errorOut, exitCode: cmd.exitCode })
      throw new PrError({ code: "CREATE_FAILED", message: sanitizeOutput(errorOut.trim() || result.trim() || "Failed to create pull request") })
    }

    await Vcs.refresh()
    const updated = await Vcs.info()
    if (updated.pr) {
      return updated.pr
    }

    const prUrl = result.trim().split("\n").pop() ?? ""
    const numberMatch = prUrl.match(/\/pull\/(\d+)/)
    if (!numberMatch) {
      throw new PrError({ code: "CREATE_FAILED", message: "Pull request was created but could not determine PR number from output" })
    }
    return {
      number: parseInt(numberMatch[1], 10),
      url: prUrl,
      title: input.title,
      state: "OPEN",
      headRefName: updated.branch || info.branch,
      baseRefName: input.base ?? updated.defaultBranch ?? info.defaultBranch ?? "main",
      isDraft: input.draft ?? false,
      mergeable: "UNKNOWN",
      reviewDecision: null,
      checksState: null,
    }
  }

  export async function ready(_input: ReadyInput): Promise<Vcs.PrInfo> {
    const { info } = await ensureGithub()
    const cwd = Instance.worktree

    const currentPr = await get()
    if (!currentPr) {
      throw new PrError({ code: "NO_PR", message: "No pull request found for the current branch" })
    }

    if (!currentPr.isDraft) {
      return currentPr
    }

    const cmd = await withTimeout(
      $`gh pr ready`
        .quiet()
        .nothrow()
        .cwd(cwd)
        .catch((e: unknown) => ({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from(String(e)) })),
      30_000,
    )

    const result = cmd.stdout.toString()
    const errorOut = cmd.stderr.toString()

    if (cmd.exitCode !== 0) {
      log.error("pr ready failed", { stdout: result, stderr: errorOut, exitCode: cmd.exitCode })
      throw new PrError({ code: "READY_FAILED", message: sanitizeOutput(errorOut.trim() || result.trim() || "Failed to mark PR as ready") })
    }

    await Vcs.refresh()
    const updated = await Vcs.info()
    return updated.pr ?? { ...currentPr, isDraft: false }
  }

  export async function merge(input: MergeInput): Promise<Vcs.PrInfo> {
    const { info } = await ensureGithub()
    const cwd = Instance.worktree

    const currentPr = await get()
    if (!currentPr) {
      throw new PrError({ code: "NO_PR", message: "No pull request found for the current branch" })
    }

    if (currentPr.mergeable === "CONFLICTING") {
      throw new PrError({ code: "MERGE_FAILED", message: "PR has merge conflicts that must be resolved first" })
    }

    const github = info.github
    if (!github?.repo) {
      throw new PrError({ code: "MERGE_FAILED", message: "Unable to determine repository information" })
    }

    const strategy = input.strategy ?? "squash"
    const mergeMethod = strategy === "squash" ? "squash" : strategy === "merge" ? "merge" : "rebase"

    const args = [
      "gh",
      "api",
      `repos/${github.repo.owner}/${github.repo.name}/pulls/${currentPr.number}/merge`,
      "-X",
      "PUT",
      "-f",
      `merge_method=${mergeMethod}`,
    ]

    const cmd = await withTimeout(
      $`${args}`
        .quiet()
        .nothrow()
        .cwd(cwd)
        .catch((e: unknown) => ({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from(String(e)) })),
      60_000,
    )

    const responseText = cmd.stdout.toString().trim()
    const errorOut = cmd.stderr.toString().trim()

    if (cmd.exitCode !== 0 || !responseText) {
      let errorMessage = errorOut || responseText || "Failed to merge pull request"
      try {
        const errorJson = JSON.parse(errorOut || responseText)
        if (errorJson.message) {
          errorMessage = errorJson.message
        }
      } catch {}
      log.error("pr merge failed", { stderr: errorOut, stdout: responseText, exitCode: cmd.exitCode })
      throw new PrError({ code: "MERGE_FAILED", message: sanitizeOutput(errorMessage) })
    }

    await Vcs.refresh()
    const updated = await Vcs.info()
    const result: Vcs.PrInfo = updated.pr ?? { ...currentPr, state: "MERGED" }

    if (input.deleteBranch === true) {
      const branchToDelete = currentPr.headRefName
      if (branchToDelete) {
        try {
          await deleteBranch({ branch: branchToDelete })
        } catch (e) {
          log.warn("post-merge branch deletion failed", { branch: branchToDelete, error: e })
          result.branchDeleteFailed = true
        }
      }
    }

    return result
  }

  export async function deleteBranch(input: DeleteBranchInput): Promise<void> {
    await ensureGithub()
    const cwd = Instance.worktree

    // Delete remote branch
    const remote = await $`git push origin --delete ${input.branch}`
      .quiet()
      .nothrow()
      .cwd(cwd)
      .catch((e: unknown) => ({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from(String(e)) }))

    if (remote.exitCode !== 0) {
      const errorOut = remote.stderr.toString().trim()
      // Ignore "remote ref does not exist" — branch may already be deleted
      if (!errorOut.includes("remote ref does not exist")) {
        log.error("delete remote branch failed", { stderr: errorOut })
        throw new PrError({ code: "DELETE_BRANCH_FAILED", message: sanitizeOutput(errorOut || "Failed to delete remote branch") })
      }
    }

    await Vcs.refresh()
  }
}
