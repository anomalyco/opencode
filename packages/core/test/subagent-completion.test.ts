import { describe, expect } from "bun:test"
import type { Job } from "@opencode/core/job"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSchema } from "@opencode/core/session/schema"
import { SubagentCompletion } from "@opencode/core/session/subagent-completion"
import { Effect } from "effect"
import { it } from "./lib/effect"

const recovery = {
  kind: "subagent" as const,
  parentSessionID: SessionSchema.ID.make("ses_deliver_parent"),
  childSessionID: SessionSchema.ID.make("ses_deliver_child"),
  agent: "explore",
  description: "Deliver report",
}

type SyntheticInput = Parameters<SubagentCompletion.SyntheticSession["synthetic"]>[0]

describe("SubagentCompletion", () => {
  it.effect("leaves the report body unchanged when no background work runs", () =>
    Effect.sync(() => {
      const child = SessionSchema.ID.make("ses_child")
      expect(SubagentCompletion.formatBody("Report body", child)).toBe("Report body")
      expect(SubagentCompletion.formatBody("Report body", child, [])).toBe("Report body")
    }),
  )

  it.effect("formats shell, image, and subagent items with descendant session context", () =>
    Effect.sync(() => {
      const child = SessionSchema.ID.make("ses_child")
      const grandchild = SessionSchema.ID.make("ses_grandchild")
      const other = SessionSchema.ID.make("ses_other")
      expect(
        SubagentCompletion.formatBody("Report body", child, [
          { kind: "shell", sessionID: child, shellID: "shell_1", command: "bun test\n  --watch" },
          { kind: "shell", sessionID: grandchild, shellID: "shell_2", command: "  echo   hi  " },
          { kind: "image", sessionID: child, path: "/tmp/chart.png", model: "openai/gpt-image-1" },
          { kind: "image", sessionID: other, path: "/tmp/other.png", model: "acme/image" },
          {
            kind: "subagent",
            sessionID: child,
            childSessionID: grandchild,
            agent: "explore",
            description: "Audit\n routes",
          },
        ]),
      ).toBe(
        [
          "Report body",
          "",
          "Background work still running:",
          "- shell (shell_1): bun test --watch",
          "- shell (shell_2, in ses_grandchild): echo hi",
          "- image (openai/gpt-image-1): /tmp/chart.png",
          "- image (acme/image, in ses_other): /tmp/other.png",
          "- subagent (explore, sessionID: ses_grandchild): Audit routes",
        ].join("\n"),
      )
    }),
  )

  it.effect("labels a completed report with pending background work as running, only in the model text", () =>
    Effect.gen(function* () {
      const notificationID = SessionMessage.ID.create()
      const sent: SyntheticInput[] = []
      const completed: SessionMessage.ID[] = []
      const sessions: SubagentCompletion.SyntheticSession = {
        synthetic: (input) =>
          Effect.sync(() => {
            sent.push(input)
            return input
          }),
      }
      const jobs = {
        completeBackground: (id: SessionMessage.ID) =>
          Effect.sync(() => {
            completed.push(id)
          }),
      } satisfies Pick<Job.Interface, "completeBackground">

      yield* SubagentCompletion.deliver(sessions, jobs, {
        status: "completed",
        output: "All green\n\nBackground work still running:\n- shell (shell_1): bun test",
        notificationID,
        recovery,
      })
      yield* SubagentCompletion.deliver(sessions, jobs, { status: "error", error: "boom", recovery })
      yield* SubagentCompletion.deliver(sessions, jobs, { status: "cancelled", recovery })
      // A running job has nothing to report and must not be acknowledged.
      yield* SubagentCompletion.deliver(sessions, jobs, { status: "running", recovery })
      yield* SubagentCompletion.deliver(sessions, jobs, { status: "completed", output: "All done", recovery })

      expect(sent).toHaveLength(4)
      expect(sent[0]?.text).toBe(
        [
          '<subagent sessionID="ses_deliver_child" state="running" description="Deliver report">',
          "All green",
          "",
          "Background work still running:",
          "- shell (shell_1): bun test",
          "</subagent>",
        ].join("\n"),
      )
      expect(sent[0]?.metadata?.state).toBe("completed")
      expect(sent[3]?.text).toBe(
        ['<subagent sessionID="ses_deliver_child" state="completed" description="Deliver report">', "All done", "</subagent>"].join(
          "\n",
        ),
      )
      expect(sent[1]?.text).toBe(
        [
          '<subagent sessionID="ses_deliver_child" state="error" description="Deliver report">',
          "boom",
          "</subagent>",
        ].join("\n"),
      )
      expect(sent[2]?.text).toBe(
        [
          '<subagent sessionID="ses_deliver_child" state="cancelled" description="Deliver report">',
          "Subagent cancelled",
          "</subagent>",
        ].join("\n"),
      )
      expect(completed).toEqual([notificationID])
    }),
  )

  it.effect("preserves a pre-formatted cancelled body so restart replay keeps running-work context", () =>
    Effect.gen(function* () {
      const notificationID = SessionMessage.ID.create()
      const sent: SyntheticInput[] = []
      const sessions: SubagentCompletion.SyntheticSession = {
        synthetic: (input) =>
          Effect.sync(() => {
            sent.push(input)
            return input
          }),
      }
      const jobs = {
        completeBackground: () => Effect.void,
      } satisfies Pick<Job.Interface, "completeBackground">
      const output = ["Subagent cancelled", "", "Background work still running:", "- shell (shell_1): bun test"].join(
        "\n",
      )

      yield* SubagentCompletion.deliver(sessions, jobs, { status: "cancelled", output, notificationID, recovery })
      yield* SubagentCompletion.deliver(sessions, jobs, { status: "cancelled", error: "Cancel failed", recovery })

      expect(sent[0]?.text).toBe(
        [
          '<subagent sessionID="ses_deliver_child" state="cancelled" description="Deliver report">',
          output,
          "</subagent>",
        ].join("\n"),
      )
      expect(sent[1]?.text).toBe(
        [
          '<subagent sessionID="ses_deliver_child" state="cancelled" description="Deliver report">',
          "Cancel failed",
          "</subagent>",
        ].join("\n"),
      )
    }),
  )
})
