import { describe, expect, test } from "bun:test"
import type { SessionInfo, SessionMessageAssistantTool, ShellInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createSessionBackground } from "@/session/requests/background"

const tool = (
  id: string,
  name: string,
  metadata: Record<string, string>,
  input: Record<string, string> = {},
  status: "completed" | "running" = "completed",
  time: SessionMessageAssistantTool["time"] = { created: 0 },
): SessionMessageAssistantTool => ({
  id,
  name,
  type: "tool",
  state:
    status === "running"
      ? { status, input, metadata }
      : { status, input, metadata, content: [{ type: "text", text: "backgrounded" }] },
  time,
})

const assistant = (id: string, content: SessionMessageAssistantTool[], completed?: number) => ({
  id,
  type: "assistant" as const,
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
  time: { created: 0, completed },
})

const session = (id: string, parentID = "root", created = 0): SessionInfo => ({
  id,
  title: id,
  parentID,
  projectID: "project",
  location: { directory: "/project" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created, updated: 0 },
})

const shell = (id: string, command: string): ShellInfo => ({
  id,
  command,
  status: "running",
  cwd: "/project",
  shell: "sh",
  file: "output",
  metadata: { sessionID: "root" },
  time: { started: 0 },
})

const notification = (id: string, metadata: Record<string, string>) => ({
  id,
  type: "synthetic" as const,
  text: "complete",
  metadata,
  time: { created: 0 },
})

describe("createSessionBackground", () => {
  test("counts a subagent from its session status, whatever its call or completion notices say", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{ status: Record<string, "idle" | "running"> }>({
        status: { stuck: "idle", noticed: "running" },
      })

      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => [
          // A background call stays "running" when no completion notice ever arrives for it.
          assistant("stuck-launch", [
            tool("stuck-part", "subagent", { status: "running", sessionID: "stuck" }, { description: "Stuck" }),
          ]),
          // An old notice for a child says nothing about its later run.
          notification("noticed-done", { source: "subagent", childID: "noticed" }),
          assistant("noticed-launch", [
            tool("noticed-part", "subagent", { status: "running", sessionID: "noticed" }, { description: "Again" }),
          ]),
          // History alone no longer counts a shell either.
          assistant("shell-launch", [tool("shell-part", "shell", { status: "running", shellID: "gone" })]),
        ],
        sessions: () => [session("stuck"), session("noticed")],
        status: (id) => store.status[id] ?? "idle",
        shells: () => [],
      })

      expect(background.tasks().map((task) => [task.id, task.label])).toEqual([["noticed", "Again"]])
      setStore("status", "stuck", "running")
      expect(background.tasks().map((task) => task.id)).toEqual(["stuck", "noticed"])
      setStore("status", { stuck: "idle", noticed: "idle" })
      expect(background.tasks()).toEqual([])
      expect(background.subagents()).toEqual([])
      dispose()
    })
  })

  test("counts every running descendant, as the TUI's family does, and nothing outside it", () => {
    createRoot((dispose) => {
      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => [],
        sessions: () => [
          session("child"),
          session("grandchild", "child"),
          session("other-child", "other"),
        ],
        status: () => "running",
        shells: () => [],
      })

      expect(background.subagents().map((task) => task.id)).toEqual(["child", "grandchild"])
      dispose()
    })
  })

  test("shows a blocking call until its child session is known, then follows the child's status", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{
        messages: ReturnType<typeof assistant>[]
        sessions: SessionInfo[]
        status: Record<string, "idle" | "running">
      }>({
        messages: [
          assistant("current", [
            tool("call", "subagent", {}, { description: "Inspect", agent: "explore" }, "running", {
              created: 5,
              ran: 6,
            }),
          ]),
        ],
        sessions: [],
        status: {},
      })

      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => store.messages,
        sessions: () => store.sessions,
        status: (id) => store.status[id] ?? "idle",
        shells: () => [],
      })

      const pending = {
        id: "call",
        type: "subagent",
        sessionID: undefined,
        partID: "call",
        label: "Inspect",
        agent: "explore",
        started: 6,
      }
      expect(background.subagents()).toEqual([pending])
      setStore("messages", 0, "content", 0, "state", "metadata", { sessionID: "child" })
      expect(background.subagents()).toEqual([{ ...pending, id: "child", sessionID: "child" }])
      setStore("sessions", [session("child")])
      expect(background.subagents()).toEqual([])
      setStore("status", "child", "running")
      expect(background.subagents()).toEqual([{ ...pending, id: "child", sessionID: "child" }])
      // Blocking work is not background work.
      expect(background.tasks()).toEqual([])
      setStore("messages", 0, "time", "completed", 7)
      expect(background.blocking()).toEqual([])
      expect(background.tasks()).toEqual([{ ...pending, id: "child", sessionID: "child", partID: undefined }])
      dispose()
    })
  })

  test("joins live tasks while idle without rescanning history, then switches sessions", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{
        id: string | undefined
        messages: ReturnType<typeof assistant>[]
        sessions: SessionInfo[]
        status: Record<string, "idle" | "running">
        shells: ShellInfo[]
      }>({
        id: "root",
        messages: [assistant("assistant", [tool("child-part", "subagent", { status: "running", sessionID: "child" })])],
        sessions: [session("live-child", "root", 40), session("child", "root", 10)],
        status: { root: "idle", child: "idle", "live-child": "idle" },
        shells: [{ ...shell("shell", "command"), status: "exited" }],
      })

      let scans = 0

      const background = createSessionBackground({
        sessionID: () => store.id,
        messages: (id) => {
          scans += 1

          return id === "root" ? store.messages : []
        },
        sessions: () => store.sessions,
        status: (id) => store.status[id],
        shells: () => store.shells,
      })

      const blocking = background.blocking()
      expect(background.tasks()).toEqual([])

      setStore("status", { child: "running", "live-child": "running" })
      setStore("shells", 0, "status", "running")
      setStore("sessions", 1, "title", "renamed")
      setStore("shells", 0, "command", "updated command")
      const live = background.tasks()
      expect(live).toEqual([
        {
          id: "live-child",
          type: "subagent",
          sessionID: "live-child",
          partID: undefined,
          label: "live-child",
          started: 40,
        },
        { id: "child", type: "subagent", sessionID: "child", partID: undefined, label: "renamed", started: 0 },
        { id: "shell", type: "shell", label: "updated command", started: 0 },
      ])
      expect(background.blocking()).toBe(blocking)
      expect(scans).toBe(1)

      setStore("id", "other")
      expect(background.tasks()).toEqual([])
      setStore("id", "root")
      expect(background.tasks()).toEqual(live)
      setStore("status", { child: "idle", "live-child": "idle" })
      setStore("shells", 0, "status", "exited")
      expect(background.tasks()).toEqual([])
      expect(scans).toBe(3)
      setStore("id", undefined)
      expect(background.tasks()).toEqual([])
      dispose()
    })
  })

  test("keeps blocking shells out of background tasks", () => {
    createRoot((dispose) => {
      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => [
          assistant("current", [
            tool("shell-part", "shell", {}, { command: "build" }, "running", { created: 30, ran: 31 }),
          ]),
        ],
        sessions: () => [],
        status: () => "idle",
        shells: () => [shell("build", "build"), { ...shell("serve", "serve"), time: { started: 50 } }],
      })

      expect(background.blocking()).toEqual([
        { type: "shell", partID: "shell-part", id: undefined, label: "build", agent: undefined, started: 31 },
      ])
      expect(background.tasks()).toEqual([{ id: "serve", type: "shell", label: "serve", started: 50 }])
      dispose()
    })
  })
})
