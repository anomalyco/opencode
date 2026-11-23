import { describe, expect, test } from "bun:test"
import type { JobInfo, SessionInfo, SessionMessageAssistantTool, ShellInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createSessionBackground } from "@/session/requests/background"

const tool = (
  id: string,
  name: string,
  metadata: Record<string, string | boolean>,
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
        sessions: () => [session("stuck", "root", 1), session("noticed", "root", 2)],
        status: (id) => store.status[id] ?? "idle",
        shells: () => [],
      })

      expect(background.tasks().map((task) => [task.id, task.label])).toEqual([["noticed", "Again"]])
      setStore("status", "stuck", "running")
      expect(background.tasks().map((task) => task.id)).toEqual(["stuck", "noticed"])
      setStore("status", { stuck: "idle", noticed: "idle" })
      expect(background.tasks()).toEqual([])
      dispose()
    })
  })

  test("counts every running descendant, as the TUI's family does, and nothing outside it", () => {
    createRoot((dispose) => {
      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => [],
        sessions: () => [session("child"), session("grandchild", "child"), session("other-child", "other")],
        status: () => "running",
        shells: () => [],
      })

      expect(background.tasks().map((task) => task.id)).toEqual(["child", "grandchild"])
      dispose()
    })
  })

  test("keeps work in the order it was created, however the lists it reads are ordered", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{ sessions: SessionInfo[]; shells: ShellInfo[]; jobs: JobInfo[] }>({
        sessions: [session("first", "root", 10), session("second", "root", 20), session("third", "second", 30)],
        shells: [
          { ...shell("serve", "serve"), time: { started: 40 } },
          { ...shell("watch", "watch"), time: { started: 50 } },
        ],
        jobs: [
          { kind: "codemode", id: "cm_build", sessionID: "root", status: "running", time: { started: 60 } },
          { kind: "codemode", id: "cm_deploy", sessionID: "root", status: "running", time: { started: 70 } },
        ],
      })

      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => [
          assistant(
            "launch",
            [
              tool("build-part", "execute", { jobID: "cm_build" }, { code: "await build()" }),
              tool("deploy-part", "execute", { jobID: "cm_deploy" }, { code: "await deploy()" }),
            ],
            1,
          ),
        ],
        sessions: () => store.sessions,
        status: () => "running",
        shells: () => store.shells,
        jobs: () => store.jobs,
      })

      const order = () => [...background.tasks(), ...background.scripts()].map((item) => item.id)
      const created = ["first", "second", "third", "serve", "watch", "cm_build", "cm_deploy"]
      expect(order()).toEqual(created)

      // The session list is most recently updated first, so a child moves to its front each time its info is read
      // again. Shells and jobs come back in the server's order after a reconnect.
      setStore("sessions", (list) => [list[2], list[0], list[1]])
      setStore("shells", (list) => list.toReversed())
      setStore("jobs", (list) => list.toReversed())
      expect(order()).toEqual(created)
      dispose()
    })
  })

  test("ignores a legacy blocking subagent call and counts its running child", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{
        messages: ReturnType<typeof assistant>[]
        sessions: SessionInfo[]
        status: Record<string, "idle" | "running">
      }>({
        messages: [
          assistant("current", [
            tool(
              "call",
              "subagent",
              { status: "running", sessionID: "child" },
              { description: "Inspect", agent: "explore" },
              "running",
              { created: 5, ran: 6 },
            ),
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

      // Subagents always run in the background, so a leftover running call blocks nothing.
      expect(background.blocking()).toEqual([])
      expect(background.tasks()).toEqual([])

      setStore("sessions", [session("child")])
      expect(background.tasks()).toEqual([])
      setStore("status", "child", "running")

      const task = {
        id: "child",
        type: "subagent",
        sessionID: "child",
        label: "Inspect",
        agent: "explore",
        started: 6,
      }

      expect(background.tasks()).toEqual([task])
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
        { id: "child", type: "subagent", sessionID: "child", label: "renamed", started: 0 },
        {
          id: "live-child",
          type: "subagent",
          sessionID: "live-child",
          label: "live-child",
          started: 40,
        },
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

  test("counts a script only once its execute call has moved it to the background", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{ messages: ReturnType<typeof assistant>[] }>({
        // Every script runs as a job, so a foreground script has a running job while its call blocks the turn.
        messages: [
          assistant("current", [
            tool("script-part", "execute", { background: true }, { code: "await build()" }, "running", {
              created: 10,
              ran: 11,
            }),
          ]),
        ],
      })

      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => store.messages,
        sessions: () => [],
        status: () => "idle",
        shells: () => [],
        jobs: () => [
          { kind: "codemode", id: "cm_script", sessionID: "root", status: "running", time: { started: 11 } },
          { kind: "codemode", id: "cm_other", sessionID: "other", status: "running", time: { started: 11 } },
        ],
      })

      expect(background.scripts()).toEqual([])

      setStore("messages", [
        assistant("current", [tool("script-part", "execute", { jobID: "cm_script" }, { code: "await build()" })]),
      ])
      expect(background.scripts()).toEqual([{ id: "cm_script", type: "script", label: "await build()", started: 11 }])
      dispose()
    })
  })

  test("names a script past a leading directive line", () => {
    createRoot((dispose) => {
      const code = '// @options: {"background": true}\nawait build()'

      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => [
          assistant("current", [
            tool(
              "running-part",
              "execute",
              { background: true },
              { code: '// @options: {"timeout": 5000}\nawait test()' },
              "running",
              {
                created: 10,
                ran: 11,
              },
            ),
            tool("script-part", "execute", { jobID: "cm_script" }, { code }),
          ]),
        ],
        sessions: () => [],
        status: () => "idle",
        shells: () => [],
        jobs: () => [
          {
            kind: "codemode",
            id: "cm_script",
            sessionID: "root",
            status: "running",
            title: "Code Mode script",
            time: { started: 11 },
          },
        ],
      })

      expect(background.scripts().map((script) => script.label)).toEqual(["await build()"])
      expect(background.blocking().map((task) => task.label)).toEqual(["await test()"])
      dispose()
    })
  })
})
