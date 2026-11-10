import { describe, expect } from "bun:test"
import { Effect } from "effect"
import type { Job } from "@opencode/core/job"
import { SessionBackground } from "@opencode/core/session/background"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSchema } from "@opencode/core/session/schema"
import { it } from "./lib/effect"

const root = SessionSchema.ID.make("ses_root")
const child = SessionSchema.ID.make("ses_child")
const grandchild = SessionSchema.ID.make("ses_grandchild")
const other = SessionSchema.ID.make("ses_other")

const sessions = new Map<
  SessionSchema.ID,
  { readonly parentID?: SessionSchema.ID; readonly agent?: string; readonly title?: string }
>([
  [root, { agent: "build", title: "Root" }],
  [child, { parentID: root, agent: "explore", title: "Child work" }],
  [grandchild, { parentID: child }],
  [other, { agent: "build", title: "Unrelated" }],
])

const store: SessionBackground.Lookup = {
  get: (sessionID) => Effect.succeed(sessions.get(sessionID)),
}

const noJobs = { runningBackground: Effect.succeed([]) }

describe("SessionBackground.outstanding", () => {
  it.effect("includes active descendants with their agent and title", () =>
    Effect.gen(function* () {
      const items = yield* SessionBackground.outstanding(noJobs, store, root, new Set([root, child, grandchild, other]))

      expect(items).toEqual([
        { kind: "subagent", sessionID: root, childSessionID: child, agent: "explore", description: "Child work" },
        { kind: "subagent", sessionID: child, childSessionID: grandchild, agent: "subagent", description: "Subagent" },
      ])
    }),
  )

  it.effect("does not duplicate running background children or include itself and unrelated sessions", () =>
    Effect.gen(function* () {
      const items = yield* SessionBackground.outstanding(
        {
          runningBackground: Effect.succeed([
            {
              kind: "subagent" as const,
              parentSessionID: root,
              childSessionID: child,
              agent: "explore",
              description: "Already running",
            },
          ]),
        },
        store,
        root,
        new Set([root, child, other]),
      )

      expect(items).toEqual([
        {
          kind: "subagent",
          sessionID: root,
          childSessionID: child,
          agent: "explore",
          description: "Already running",
        },
      ])
      expect(yield* SessionBackground.outstanding(noJobs, store, root, new Set([root, other]))).toEqual([])
    }),
  )

  it.effect("skips created foreground-blocking and cancelled descendants when job state is available", () =>
    Effect.gen(function* () {
      const jobs = {
        runningBackground: Effect.succeed([]),
        get: (sessionID: string) =>
          Effect.succeed(
            sessionID === grandchild
              ? info(grandchild, "running")
              : sessionID === other
                ? info(other, "cancelled")
                : undefined,
          ),
      }

      // A foreground subagent's inline caller owns its result, and a cancelled one is
      // acknowledged elsewhere: neither is still running for this report.
      expect(yield* SessionBackground.outstanding(jobs, store, root, new Set([grandchild, other]))).toEqual([])

      expect(
        yield* SessionBackground.outstanding(
          {
            runningBackground: Effect.succeed([]),
            get: (sessionID) =>
              Effect.succeed(
                sessionID === grandchild ? info(grandchild, "running", SessionMessage.ID.create()) : undefined,
              ),
          },
          store,
          root,
          new Set([grandchild]),
        ),
      ).toEqual([
        { kind: "subagent", sessionID: child, childSessionID: grandchild, agent: "subagent", description: "Subagent" },
      ])
    }),
  )
})

const info = (id: SessionSchema.ID, status: Job.Status, notificationID?: SessionMessage.ID): Job.Info => ({
  id,
  type: "subagent",
  status,
  started_at: 0,
  ...(notificationID ? { notificationID } : {}),
})
