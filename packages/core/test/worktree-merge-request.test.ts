import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import { DateTime, Effect, Exit } from "effect"
import { Git } from "@opencode-ai/core/git"
import { Location } from "@opencode-ai/core/location"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Tool } from "@opencode-ai/core/tool/tool"
import { WorktreeMergeRequestTool } from "@opencode-ai/core/tool/worktree-merge-request"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Git.defaultLayer)

async function initRepo(directory: string) {
  await $`git init`.cwd(directory).quiet()
  await $`git config core.fsmonitor false`.cwd(directory).quiet()
  await $`git config commit.gpgsign false`.cwd(directory).quiet()
  await $`git config user.email test@opencode.test`.cwd(directory).quiet()
  await $`git config user.name Test`.cwd(directory).quiet()
  await $`git commit --allow-empty -m root`.cwd(directory).quiet()
}

const context = (sessionID: SessionSchema.ID): Tool.Context => ({
  sessionID,
  agent: "build" as Tool.Context["agent"],
  assistantMessageID: "msg_test" as Tool.Context["assistantMessageID"],
  toolCallID: "call_test",
})

// Records SessionV2 create/prompt calls and returns the current worktree session
// via `get`, so the tool can resolve its worktree directory.
function recordingSession(input: {
  worktreeSession: SessionSchema.Info
  created: SessionSchema.Info[]
  prompts: { sessionID: string; text: string }[]
}) {
  return {
    get: (sessionID: SessionSchema.ID) =>
      sessionID === input.worktreeSession.id
        ? Effect.succeed(input.worktreeSession)
        : Effect.fail(new SessionV2.NotFoundError({ sessionID })),
    create: (createInput: { location: Location.Ref }) => {
      const created = SessionSchema.Info.make({
        ...input.worktreeSession,
        id: SessionSchema.ID.create(),
        location: createInput.location,
      })
      input.created.push(created)
      return Effect.succeed(created)
    },
    prompt: (promptInput: { sessionID: SessionSchema.ID; prompt: { text: string } }) => {
      input.prompts.push({ sessionID: promptInput.sessionID, text: promptInput.prompt.text })
      return Effect.succeed({} as never)
    },
  } as unknown as SessionV2.Interface
}

describe("WorktreeMergeRequestTool", () => {
  it.live("spawns a merge session in the main checkout for a worktree branch", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const mainCheckout = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(root.path)))
      const worktree = AbsolutePath.make(`${mainCheckout}-wt`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(worktree, { recursive: true, force: true })).pipe(Effect.ignore),
      )

      const git = yield* Git.Service
      // Create a worktree on branch `opencode/feature`, matching how the web app
      // creates worktrees (a real branch, not detached HEAD).
      yield* Effect.promise(() =>
        $`git worktree add -b opencode/feature ${worktree} HEAD`.cwd(mainCheckout).quiet().then(() => undefined),
      )
      const realWorktree = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(worktree)))
      const worktreeRepo = yield* git.repo.discover(realWorktree)
      expect(yield* git.history.branch(worktreeRepo!)).toBe("opencode/feature")

      const now = yield* DateTime.now
      const worktreeSessionID = SessionSchema.ID.create()
      const worktreeSession = SessionSchema.Info.make({
        id: worktreeSessionID,
        projectID: "global" as SessionSchema.Info["projectID"],
        agent: "build" as SessionSchema.Info["agent"],
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: now, updated: now },
        title: "Worktree session",
        location: Location.Ref.make({ directory: realWorktree }),
      })
      const created: SessionSchema.Info[] = []
      const prompts: { sessionID: string; text: string }[] = []
      const tool = WorktreeMergeRequestTool.make({
        session: recordingSession({ worktreeSession, created, prompts }),
        git,
      })

      const output = yield* Tool.settle(
        tool,
        {
          type: "tool-call",
          id: "call_test",
          name: WorktreeMergeRequestTool.name,
          input: { summary: "Added a feature", squashCommitMessage: "feat: add a feature" },
        },
        context(worktreeSessionID),
      )

      // A merge session was created in the MAIN checkout, not the worktree.
      expect(created).toHaveLength(1)
      expect(created[0].location.directory).toBe(mainCheckout)
      // The main-checkout session was prompted to do the squash merge.
      expect(prompts).toHaveLength(1)
      expect(prompts[0].sessionID).toBe(created[0].id)
      expect(prompts[0].text).toContain("git merge --squash opencode/feature")
      expect(prompts[0].text).toContain("DO NOT `git push`")
      // The structured output reports the spawned session and target directory.
      expect(output.structured).toMatchObject({
        targetSessionID: created[0].id,
        targetDirectory: mainCheckout,
        branch: "opencode/feature",
      })
    }).pipe(Effect.scoped),
  )

  it.live("rejects when called from the main checkout (not a worktree)", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const mainCheckout = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(root.path)))

      const git = yield* Git.Service
      const now = yield* DateTime.now
      const sessionID = SessionSchema.ID.create()
      const session = SessionSchema.Info.make({
        id: sessionID,
        projectID: "global" as SessionSchema.Info["projectID"],
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: now, updated: now },
        title: "Main session",
        location: Location.Ref.make({ directory: mainCheckout }),
      })
      const created: SessionSchema.Info[] = []
      const prompts: { sessionID: string; text: string }[] = []
      const tool = WorktreeMergeRequestTool.make({
        session: recordingSession({ worktreeSession: session, created, prompts }),
        git,
      })

      const exit = yield* Tool.settle(
        tool,
        {
          type: "tool-call",
          id: "call_test",
          name: WorktreeMergeRequestTool.name,
          input: { summary: "x", squashCommitMessage: "chore: x" },
        },
        context(sessionID),
      ).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(created).toHaveLength(0)
      expect(prompts).toHaveLength(0)
    }).pipe(Effect.scoped),
  )
})
