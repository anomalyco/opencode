import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { storyTool } from "../storybook/current-session-scenarios"

export function commentaryRuns() {
  const step = (id: string, created: number, content: SessionMessageAssistant["content"], completed?: number) =>
    ({
      id,
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content,
      time: { created, completed },
    }) satisfies SessionMessageInfo

  const user = { id: "user", type: "user", text: "Check the job", time: { created: 0 } } as const

  const reply = step("reply", 1, [{ type: "text", text: "The job is queued." }], 2)

  const idle = (id: string, created: number) =>
    ({ id, type: "idle", outcome: "succeeded", time: { created } }) satisfies SessionMessageInfo

  const notice = (id: string, created: number) =>
    ({
      id,
      type: "synthetic",
      text: "Job updated",
      description: "Job updated",
      metadata: { source: "console.watch" },
      time: { created },
    }) satisfies SessionMessageInfo

  const complete = [
    user,
    reply,
    idle("idle", 3),
    ...[1, 2, 3].flatMap((index) => {
      const created = index * 10

      return [
        notice(`notice-${index}`, created),
        step(
          `work-${index}`,
          created + 1,
          [{ type: "text", text: "Checking the update." }, storyTool(`tool-${index}`, "execute", "completed", {})],
          created + 2,
        ),
        step(`reply-${index}`, created + 3, [{ type: "text", text: "I checked the update." }], created + 4),
        idle(`idle-${index}`, created + 5),
      ]
    }),
    { ...user, id: "next-user", time: { created: 40 } },
  ]

  const prior = step(
    "prior",
    1,
    [{ type: "text", text: "Waiting for the result.", native: { phase: "commentary" } }],
    2,
  )

  const wake = [
    notice("wake", 4),
    step("working", 5, [{ type: "text", text: "Checking again." }, storyTool("running", "execute", "running", {})]),
  ]

  const busy = [user, prior, idle("idle", 3), ...wake]

  const failed = [
    user,
    prior,
    {
      id: "failed",
      type: "idle",
      outcome: "failed",
      error: { type: "provider.no-route", message: "Model unavailable" },
      time: { created: 3 },
    },
    ...wake,
  ] satisfies SessionMessageInfo[]

  return { complete, busy, failed }
}
