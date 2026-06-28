import { Effect, Schema } from "effect"
import path from "path"
import * as Tool from "./tool"
import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"

const id = "worktree_merge_request"

const DESCRIPTION = [
  "Request that the changes on this git worktree be squash-merged back into the project's default branch.",
  "",
  "Use this ONLY when you are working inside an isolated git worktree and the task is complete.",
  "Before calling this tool you MUST commit all changes in this worktree (do NOT push).",
  "",
  "This tool does not perform the merge itself. It starts a separate session in the project's",
  "main checkout directory and instructs that session's agent to squash-merge this worktree's branch.",
  "Provide a clear, user-facing `summary` of what this worktree accomplished and a recommended",
  "`squashCommitMessage`. The main-checkout agent will use both to produce the squash commit.",
].join("\n")

const SYSTEM_PROMPT =
  "You are operating in the project's main git checkout to squash-merge a worktree branch. " +
  "Never push, never open a PR, never remove the worktree. Abort and report on any merge conflict."

export const Parameters = Schema.Struct({
  summary: Schema.String.annotate({
    description:
      "A clear, user-facing summary of what this worktree accomplished (the WHY), used to give the main-checkout agent context for the merge.",
  }),
  squashCommitMessage: Schema.String.annotate({
    description:
      "A recommended squash commit message. Use a conventional prefix like feat:, fix:, docs:, chore:, refactor:, test:. Explain WHY from the user's perspective, be specific about user-facing changes.",
  }),
})

type Metadata = {
  targetSessionID?: string
  targetDirectory?: string
  branch?: string
  defaultBranch?: string
}

function mergePrompt(input: {
  worktreeDirectory: string
  branch: string
  defaultBranch: string
  summary: string
  squashCommitMessage: string
}) {
  return [
    "You are completing a squash merge of a git worktree branch into the project's default branch.",
    "You are running in the project's MAIN checkout. Perform every step here, in your own working directory.",
    "",
    "## Context",
    `- Worktree directory: ${input.worktreeDirectory}`,
    `- Worktree branch to merge: ${input.branch}`,
    `- Default (target) branch: ${input.defaultBranch}`,
    "",
    "## What the worktree accomplished (summary from the worktree agent)",
    input.summary,
    "",
    "## Recommended squash commit message (from the worktree agent)",
    input.squashCommitMessage,
    "",
    "## Steps (do these in order, in your current main-checkout directory)",
    "1. Run `git status` to confirm the main checkout working tree is clean. If it is NOT clean,",
    "   STOP immediately, do not merge, and tell the user which files are dirty.",
    `2. Confirm you are on the default branch (\`${input.defaultBranch}\`). If not, check it out.`,
    `3. Run \`git merge --squash ${input.branch}\`.`,
    "4. If the merge reports conflicts:",
    "   - Run `git merge --abort` to restore the clean state.",
    "   - DO NOT attempt to resolve the conflicts yourself.",
    "   - List the conflicting files and clearly tell the user they must resolve them manually",
    `     (for example by rebasing \`${input.branch}\` onto \`${input.defaultBranch}\` in the worktree), then retry.`,
    "   - End the task here.",
    "5. If there are no conflicts, create the squash commit with `git commit` using the recommended",
    "   message above (refine it if needed to accurately describe the changes).",
    "",
    "## Hard constraints",
    "- DO NOT `git push`.",
    "- DO NOT open a pull request.",
    "- DO NOT remove or reset the worktree; the user will decide what to do with it.",
    "- DO NOT modify files unrelated to resolving the merge.",
  ].join("\n")
}

export const WorktreeMergeRequestTool = Tool.define<typeof Parameters, Metadata, Git.Service>(
  id,
  Effect.gen(function* () {
    const git = yield* Git.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const worktreeDirectory = instance.directory

          if (instance.project.vcs !== "git") {
            return yield* Effect.fail(new Error("worktree_merge_request requires a git project."))
          }

          // Derive the project's MAIN checkout from the shared git store
          // (`--git-common-dir`), which for a linked worktree resolves to
          // `<mainCheckout>/.git`. The instance's `worktree` field is NOT the
          // main checkout for a worktree session (it resolves to the worktree's
          // own toplevel), so it cannot be trusted here.
          const commonDir = (yield* git.run(["rev-parse", "--git-common-dir"], { cwd: worktreeDirectory })).text().trim()
          if (!commonDir) {
            return yield* Effect.fail(new Error("Could not locate the git directory for this worktree."))
          }
          const absoluteCommonDir = path.isAbsolute(commonDir)
            ? commonDir
            : path.resolve(worktreeDirectory, commonDir)
          const mainCheckout =
            path.basename(absoluteCommonDir) === ".git" ? path.dirname(absoluteCommonDir) : absoluteCommonDir

          if (mainCheckout === worktreeDirectory) {
            return yield* Effect.fail(
              new Error(
                "worktree_merge_request can only be used from a git worktree session, not from the project's main checkout.",
              ),
            )
          }

          const branch = yield* git.branch(worktreeDirectory)
          if (!branch) {
            return yield* Effect.fail(
              new Error("Could not determine the current worktree branch (it may be in a detached HEAD state)."),
            )
          }
          const base = yield* git.defaultBranch(mainCheckout)
          const defaultBranch = base?.name
          if (!defaultBranch) {
            return yield* Effect.fail(new Error("Could not determine the project's default branch."))
          }
          if (branch === defaultBranch) {
            return yield* Effect.fail(
              new Error(`The worktree is already on the default branch (${defaultBranch}); nothing to merge.`),
            )
          }

          // Reuse the model from the most recent assistant message in this
          // worktree session so the merge session runs with the same model.
          const lastAssistant = [...ctx.messages]
            .reverse()
            .map((m) => m.info)
            .find((info): info is Extract<typeof info, { role: "assistant" }> => info.role === "assistant")
          const model = lastAssistant
            ? { providerID: lastAssistant.providerID, modelID: lastAssistant.modelID }
            : undefined

          // Dynamic import keeps the cross-instance orchestration (AppRuntime,
          // Session, SessionPrompt) out of this tool's static import graph,
          // which would otherwise create a circular dependency through the tool
          // registry.
          const { startMerge } = yield* Effect.promise(() => import("./worktree-merge-request/orchestrate"))
          const target = yield* Effect.promise(() =>
            startMerge({
              mainCheckout,
              branch,
              system: SYSTEM_PROMPT,
              model,
              prompt: mergePrompt({
                worktreeDirectory,
                branch,
                defaultBranch,
                summary: params.summary,
                squashCommitMessage: params.squashCommitMessage,
              }),
            }),
          )

          return {
            title: `Merge ${branch} into ${defaultBranch}`,
            output: [
              `Started a squash-merge session in the main checkout (${mainCheckout}).`,
              `Branch to merge: ${branch} -> ${defaultBranch}.`,
              `Tracking session: ${target.sessionID}.`,
              "Tell the user the merge has been started in the main checkout and that they can open the",
              "tracking session to watch its progress. Do not attempt the merge yourself.",
            ].join("\n"),
            metadata: {
              targetSessionID: target.sessionID,
              targetDirectory: target.directory,
              branch,
              defaultBranch,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
