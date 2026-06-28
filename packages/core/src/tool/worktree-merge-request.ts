export * as WorktreeMergeRequestTool from "./worktree-merge-request"

import path from "path"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import { Git } from "../git"
import { Location } from "../location"
import { SessionV2 } from "../session"
import { Prompt } from "../session/prompt"
import { AbsolutePath } from "../schema"
import { Tool } from "./tool"

export const name = "worktree_merge_request"

export const description = [
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

export const Input = Schema.Struct({
  summary: Schema.String.annotate({
    description:
      "A clear, user-facing summary of what this worktree accomplished (the WHY), used to give the main-checkout agent context for the merge.",
  }),
  squashCommitMessage: Schema.String.annotate({
    description:
      "A recommended squash commit message. Use a conventional prefix like feat:, fix:, docs:, chore:, refactor:, test:. Explain WHY from the user's perspective, be specific about user-facing changes.",
  }),
})

export const Output = Schema.Struct({
  targetSessionID: Schema.String,
  targetDirectory: Schema.String,
  branch: Schema.String,
})

// The main checkout is derived from the shared git store (`--git-common-dir`),
// which for a linked worktree resolves to `<mainCheckout>/.git`. This mirrors
// `project/copy-strategies.ts` and is the only reliable way to recover the
// primary working tree from inside a worktree, because both
// `ProjectV2.resolve(...).directory` and the stored project `worktree` column
// return the worktree's own toplevel for a worktree session.
function mainCheckoutFromStore(store: AbsolutePath) {
  return AbsolutePath.make(path.basename(store) === ".git" ? path.dirname(store) : store)
}

function mergePrompt(input: {
  worktreeDirectory: string
  branch: string
  summary: string
  squashCommitMessage: string
}) {
  return [
    "You are completing a squash merge of a git worktree branch into the project's default branch.",
    "You are running in the project's MAIN checkout. Perform every step here, in your own working directory.",
    "Never push, never open a pull request, never remove the worktree. Abort and report on any merge conflict.",
    "",
    "## Context",
    `- Worktree directory: ${input.worktreeDirectory}`,
    `- Worktree branch to merge: ${input.branch}`,
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
    "2. Determine the default branch (the branch HEAD points to in this main checkout) and confirm",
    "   you are on it. If not, check it out.",
    `3. Run \`git merge --squash ${input.branch}\`.`,
    "4. If the merge reports conflicts:",
    "   - Run `git merge --abort` to restore the clean state.",
    "   - DO NOT attempt to resolve the conflicts yourself.",
    "   - List the conflicting files and clearly tell the user they must resolve them manually",
    `     (for example by rebasing \`${input.branch}\` onto the default branch in the worktree), then retry.`,
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

/**
 * Builds the process-global `worktree_merge_request` tool. It must be
 * constructed where `SessionV2.Service` is reachable (the server composition
 * root), not inside `LocationServiceMap`, because spawning a session in the
 * main checkout requires the process-global Session service that is wired
 * ABOVE the Location service map.
 */
export const make = (deps: { session: SessionV2.Interface; git: Git.Interface }) =>
  Tool.make({
    description,
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [
      {
        type: "text",
        text: [
          `Started a squash-merge session in the main checkout (${output.targetDirectory}).`,
          `Branch to merge: ${output.branch}.`,
          `Tracking session: ${output.targetSessionID}.`,
          "Tell the user the merge has been started in the main checkout and that they can open the",
          "tracking session to watch its progress. Do not attempt the merge yourself.",
        ].join("\n"),
      },
    ],
    execute: (input, context) =>
      Effect.gen(function* () {
        const current = yield* deps.session
          .get(context.sessionID)
          .pipe(Effect.mapError(() => new ToolFailure({ message: "Could not load the current session." })))
        const worktreeDirectory = current.location.directory

        const repo = yield* deps.git.find(worktreeDirectory)
        if (!repo) {
          return yield* new ToolFailure({ message: "worktree_merge_request requires a git project." })
        }
        const mainCheckout = mainCheckoutFromStore(repo.store)
        if (mainCheckout === worktreeDirectory) {
          return yield* new ToolFailure({
            message:
              "worktree_merge_request can only be used from a git worktree session, not from the project's main checkout.",
          })
        }

        const branch = yield* deps.git.branch(worktreeDirectory)
        if (!branch) {
          return yield* new ToolFailure({
            message:
              "Could not determine the current worktree branch (the worktree may be in a detached HEAD state).",
          })
        }

        // Run the merge session in the main checkout, reusing this session's
        // model and agent so the merge behaves consistently.
        const target = yield* deps.session
          .create({
            location: Location.Ref.make({ directory: mainCheckout }),
            agent: current.agent,
            model: current.model,
          })
          .pipe(Effect.mapError(() => new ToolFailure({ message: "Could not create the merge session." })))

        yield* deps.session
          .prompt({
            sessionID: target.id,
            prompt: Prompt.fromUserMessage({
              text: mergePrompt({
                worktreeDirectory,
                branch,
                summary: input.summary,
                squashCommitMessage: input.squashCommitMessage,
              }),
            }),
          })
          .pipe(Effect.mapError(() => new ToolFailure({ message: "Could not start the merge session." })))

        return {
          targetSessionID: target.id,
          targetDirectory: mainCheckout,
          branch,
        }
      }),
  })
