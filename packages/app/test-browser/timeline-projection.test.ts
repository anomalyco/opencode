import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionStatus } from "@opencode-ai/client/promise"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import {
  createReactiveTimelineProjection,
  reuseTimelineRows,
  Timeline,
  TimelineRow,
  type ReasoningMode,
} from "@opencode-ai/session-ui/timeline/projection"
import { createTimelineProjection } from "../src/session/timeline/projection"

const assistant = (id: string, content: SessionMessageAssistant["content"]): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  time: { created: 2 },
  content,
})

for (const factory of [createTimelineProjection, createReactiveTimelineProjection]) {
  describe(factory.name, () => {
    test("only crosses the renderable boundary on text deltas, while retaining live content", () => {
      createRoot((dispose) => {
        let visits = 0
        const [state, setState] = createStore({
          messages: [
            {
              id: "old",
              type: "user",
              text: "history",
              get time() {
                visits++
                return { created: 0 }
              },
            },
            assistant("old-answer", [{ type: "text", text: "History remains visible." }]),
            { id: "user", type: "user", text: "question", time: { created: 1 } },
            assistant("answer", [{ type: "text", text: "" }]),
          ] as SessionMessageInfo[],
        })
        const projection = factory({
          sessionMessages: () => state.messages,
          status: () => ({ type: "busy" }),
          reasoningMode: () => "compact",
          shellToolDefaultOpen: () => false,
          editToolDefaultOpen: () => false,
          pendingUserMessageIDs: () => new Set(),
        })
        const update = (text: string) =>
          setState(
            "messages",
            3,
            produce((message) => {
              if (message.type === "assistant" && message.content[0].type === "text") message.content[0].text = text
            }),
          )
        const empty = projection.rows()
        visits = 0
        update(" \n\t")
        expect(projection.rows()).toBe(empty)
        expect(visits).toBe(0)
        update("The first visible answer.")
        const visible = projection.rows()
        expect(visible.length).toBe(empty.length + 1)
        expect(visits).toBeGreaterThan(0)
        visits = 0
        update("The first visible answer. More streamed words.")
        expect(projection.rows()).toBe(visible)
        expect(visits).toBe(0)
        expect(Timeline.resolveContent(projection.messageByID().get("answer"), "answer:text:0")).toMatchObject({
          text: "The first visible answer. More streamed words.",
        })
        update("")
        expect(projection.rows()).toEqual(empty)
        expect(visits).toBeGreaterThan(0)
        dispose()
      })
    })

    test("matches full construction through grouping, notices, history and preference transitions", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore({
          messages: [
            assistant("answer", [
              { type: "reasoning", text: "Inspect the source", time: { created: 1 } },
              {
                type: "tool",
                id: "read",
                name: "read",
                state: { status: "completed", input: {}, content: [{ type: "text", text: "read" }], metadata: {} },
                time: { created: 1 },
              },
              { type: "text", text: "" },
              {
                type: "tool",
                id: "shell",
                name: "shell",
                state: { status: "running", input: {}, metadata: {} },
                time: { created: 1 },
              },
              {
                type: "tool",
                id: "question",
                name: "question",
                state: { status: "running", input: {}, metadata: {} },
                time: { created: 1 },
              },
            ]),
          ] as SessionMessageInfo[],
          status: { type: "busy" } as SessionStatus,
          reasoning: "compact" as ReasoningMode,
          shell: false,
          edit: false,
          pending: new Set<string>(),
        })
        const projection = factory({
          sessionMessages: () => state.messages,
          status: () => state.status,
          reasoningMode: () => state.reasoning,
          shellToolDefaultOpen: () => state.shell,
          editToolDefaultOpen: () => state.edit,
          pendingUserMessageIDs: () => state.pending,
        })
        let previous: TimelineRow.TimelineRow[] | undefined
        const verify = () => {
          const full = Timeline.constructSessionMessageRows(
            state.messages,
            state.reasoning !== "hidden",
            state.status,
            state.pending,
            state.shell,
            state.edit,
          )
          previous = reuseTimelineRows(previous, full.rows)
          expect(projection.rows()).toEqual(previous)
          expect(projection.activeMessageID()).toBe(full.activeMessageID)
          expect([...projection.rowByKey().keys()]).toEqual(previous.map(TimelineRow.key))
          expect([...projection.messageByID().keys()]).toEqual(state.messages.map((message) => message.id))
          previous.forEach((row, index) => {
            expect(projection.messageRowIndex().get(row.userMessageID)).toBe(
              previous!.findIndex((item) => item.userMessageID === row.userMessageID),
            )
            expect(projection.messageLastRowIndex().get(row.userMessageID)).toBe(
              previous!.findLastIndex((item) => item.userMessageID === row.userMessageID),
            )
            expect(projection.rowByKey().get(TimelineRow.key(row))).toBe(projection.rows()[index])
          })
        }
        const change = (update: (message: SessionMessageAssistant) => void) => {
          setState(
            "messages",
            (message) => message.id === "answer",
            produce((message) => {
              if (message.type === "assistant") update(message)
            }),
          )
          verify()
        }
        verify()
        change((message) => {
          if (message.content[2].type === "text") message.content[2].text = "Split the context group"
        })
        change((message) => {
          if (message.content[2].type === "text") message.content[2].text = " \n"
        })
        change((message) => {
          if (message.content[0].type === "reasoning") message.content[0].text += " and its callers"
        })
        setState("reasoning", "hidden")
        verify()
        setState("reasoning", "full")
        verify()
        change((message) => {
          if (message.content[1].type === "tool" && message.content[1].state.status === "completed")
            message.content[1].state.metadata = { loaded: ["src/example.ts"] }
        })
        change((message) => {
          if (message.content[3].type === "tool")
            message.content[3].state = {
              status: "completed",
              input: {},
              metadata: {},
              content: [{ type: "text", text: "ok" }],
            }
        })
        setState("shell", true)
        verify()
        change((message) => {
          if (message.content[4].type === "tool")
            message.content[4].state = {
              status: "completed",
              input: {},
              metadata: {},
              content: [{ type: "text", text: "answered" }],
            }
        })
        change((message) => {
          message.content.push({
            type: "tool",
            id: "edit",
            name: "edit",
            state: {
              status: "completed",
              input: {},
              metadata: { files: [{ status: "deleted" }] },
              content: [{ type: "text", text: "edited" }],
            },
            time: { created: 1 },
          })
        })
        setState("edit", true)
        verify()
        change((message) => {
          const tool = message.content.at(-1)
          if (tool?.type === "tool" && tool.state.status === "completed")
            tool.state.metadata = { files: [{ status: "modified" }] }
        })
        change((message) => {
          message.content.push({ type: "reasoning", text: "Working", time: { created: 3 } })
        })
        expect(projection.rows().at(-1)?._tag).toBe("Thinking")
        change((message) => {
          const part = message.content.at(-1)
          if (part?.type === "reasoning") part.time = { created: 3, completed: 4 }
        })
        change((message) => {
          message.retry = { attempt: 1, at: 3, error: { type: "Retry", message: "retry" } }
        })
        change((message) => {
          message.retry = undefined
          message.error = { type: "Interrupted", message: "stopped" }
        })
        change((message) => {
          message.error = { type: "Error", message: "failed" }
        })
        change((message) => {
          message.error = undefined
          message.time.completed = 5
        })
        setState("status", { type: "idle" })
        verify()
        setState(
          "messages",
          produce((messages) =>
            messages.unshift({ id: "user", type: "user", text: "Earlier page", time: { created: 0 } }),
          ),
        )
        verify()
        expect(projection.assistantMessagesByParent().get("user")?.[0].id).toBe("answer")
        expect(projection.userContextByID().get("user")?.agent).toBe("build")
        setState(
          "messages",
          produce((messages) =>
            messages.push(
              { id: "notice", type: "synthetic", text: "hidden", time: { created: 6 } },
              assistant("later", [{ type: "text", text: "Later work" }]),
            ),
          ),
        )
        verify()
        setState("messages", (message) => message.id === "notice", { description: "Visible notice" })
        verify()
        setState(
          "messages",
          produce((messages) => messages.push({ id: "pending", type: "user", text: "Steer", time: { created: 8 } })),
        )
        setState("pending", new Set(["pending"]))
        verify()
        expect(projection.activeMessageID()).toBe("user")
        setState("pending", new Set())
        verify()
        expect(projection.activeMessageID()).toBe("pending")
        const all = [...state.messages]
        setState("messages", (messages) => messages.slice(0, 2))
        verify()
        setState("messages", all)
        verify()
        change((message) => {
          message.content = [{ type: "text", text: "Replacement" }]
        })
        setState("messages", [])
        verify()
        setState("messages", [assistant("new-session", [{ type: "text", text: "New session" }])])
        verify()
        dispose()
      })
    })
  })
}
