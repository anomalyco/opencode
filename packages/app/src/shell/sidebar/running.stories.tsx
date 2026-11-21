import type { SessionInfo, ShellInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { For, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { ServerConnection } from "@/runtime/server/registry"
import type { ServerCtx } from "@/runtime/server/runtime"
import { ServerScope } from "@/runtime/server/scope"
import { RunningSessions } from "./running"

function RunningStory(props: { failures: number }) {
  const conn: ServerConnection.Http = {
    type: "http",
    http: { url: "http://running.local" },
    displayName: "Local",
  }

  const server = ServerConnection.key(conn)

  const sessions: SessionInfo[] = ["Build", "Child", "Background"].map((title, index) => ({
    id: title.toLowerCase(),
    title,
    parentID: index === 1 ? "build" : undefined,
    projectID: "project",
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: { created: 0, updated: 0, busy: Date.now() - 65_000 },
    location: { directory: "/project" },
  }))

  const shell = (id: string): ShellInfo => ({
    id: `shell-${id}`,
    status: "running",
    command: "bun run build",
    cwd: "/project",
    shell: "/bin/sh",
    file: "/shell.out",
    metadata: { sessionID: id },
    time: { started: Date.now() - 65_000 },
  })

  const [state, setState] = createStore({
    connected: true,
    active: ["build"],
    shells: [shell("background")],
    selected: "",
    touched: "",
    branch: "",
    attempts: 0,
    requests: Object.fromEntries(
      sessions.flatMap((item) => ["info", "permission", "form"].map((kind) => [`${item.id}:${kind}`, 0])),
    ),
  })

  const sync = (kind: string, id: string) => {
    untrack(() => setState("requests", `${id}:${kind}`, (count = 0) => count + 1))

    return Promise.resolve()
  }

  // SAFETY: This local fixture implements every ServerCtx member read by RunningSessions and its branch loader.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- partial local server fixture, see SAFETY above
  const ctx = {
    sdk: {
      scope: ServerScope.fromServerKey(server),
      connection: {
        status: () => (state.connected ? "connected" : "disconnected"),
      },
    },
    projects: {
      forSession: () => ({ worktree: "/project" }),
      touch: (path: string) => setState("touched", path),
    },
    data: {
      session: {
        active: () => state.active,
        get: (id: string) => sessions.find((item) => item.id === id),
        list: () => sessions,
        root: (id: string) => (id === "child" ? "build" : id),
        status: (id: string) => (state.active.includes(id) ? "running" : "idle"),
        sync: (id: string) => sync("info", id),
        permission: {
          list: () => [],
          sync: (id: string) => sync("permission", id),
        },
        form: { list: () => [], sync: (id: string) => sync("form", id) },
      },
      shell: {
        activeSessions: () => state.shells.map((item) => item.metadata!.sessionID),
        listBySession: (id: string) => state.shells.filter((item) => item.metadata!.sessionID === id),
      },
      location: {
        info: () => ({ directory: "/project" }),
        vcs: {
          info: () => (state.branch ? { branch: { current: state.branch } } : undefined),
          sync: async () => {
            const attempt = untrack(() => state.attempts + 1)
            setState("attempts", attempt)

            if (attempt <= props.failures) throw new Error("Git unavailable")
            setState("branch", "main")
          },
        },
      },
    },
  } as unknown as ServerCtx

  return (
    <div class="flex w-80 flex-col gap-3">
      <RunningSessions
        connections={[{ conn, ctx }]}
        selected={{ server, sessionID: state.selected }}
        onOpen={(_, id) => setState("selected", id)}
      />
      <div class="flex flex-wrap gap-2">
        <Button onClick={() => setState("active", ["build", "child"])}>Start child</Button>
        <Button onClick={() => setState("shells", [shell("background"), shell("build")])}>Start build shell</Button>
        <Button onClick={() => setState("shells", [])}>Stop shells</Button>
        <Button onClick={() => setState("connected", !state.connected)}>
          {state.connected ? "Disconnect" : "Reconnect"}
        </Button>
      </div>
      <output aria-label="Opened session">{state.selected}</output>
      <output aria-label="Touched project">{state.touched}</output>
      <output aria-label="Branch attempts">{state.attempts}</output>
      <For each={sessions}>
        {(session) => (
          <output aria-label={`${session.title} requests`}>
            {["info", "permission", "form"].map((kind) => state.requests[`${session.id}:${kind}`] ?? 0).join(",")}
          </output>
        )}
      </For>
    </div>
  )
}

export default {
  id: "sidebar-running",
  title: "App / Sidebar / Running",
  render: RunningStory,
  args: { failures: 0 },
}

export const Overview = {}

export const Retry = { args: { failures: 3 } }
