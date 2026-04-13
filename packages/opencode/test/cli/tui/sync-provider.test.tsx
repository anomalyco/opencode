/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ArgsProvider } from "../../../src/cli/cmd/tui/context/args"
import { ExitProvider } from "../../../src/cli/cmd/tui/context/exit"
import { ProjectProvider, useProject } from "../../../src/cli/cmd/tui/context/project"
import { SDKProvider } from "../../../src/cli/cmd/tui/context/sdk"
import { SyncProvider, useSync } from "../../../src/cli/cmd/tui/context/sync"

const sighup = new Set(process.listeners("SIGHUP"))

afterEach(() => {
  for (const fn of process.listeners("SIGHUP")) {
    if (!sighup.has(fn)) process.off("SIGHUP", fn)
  }
})

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
    },
  })
}

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function data(workspace?: string | null) {
  const tag = workspace ?? "root"
  return {
    session: {
      id: "ses_1",
      title: `session-${tag}`,
      workspaceID: workspace ?? undefined,
      time: {
        updated: 1,
      },
    },
    message: {
      info: {
        id: "msg_1",
        sessionID: "ses_1",
        role: "assistant",
        time: {
          created: 1,
          completed: 1,
        },
      },
      parts: [
        {
          id: "part_1",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "text",
          text: `part-${tag}`,
        },
      ],
    },
    todo: [
      {
        id: `todo-${tag}`,
        content: `todo-${tag}`,
        status: "pending",
        priority: "medium",
      },
    ],
    diff: [
      {
        file: `${tag}.ts`,
        patch: "",
        additions: 0,
        deletions: 0,
      },
    ],
  }
}

type Hit = {
  path: string
  workspace?: string
}

function createFetch(log: Hit[]) {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const url = new URL(req.url)
      const workspace = url.searchParams.get("workspace") ?? req.headers.get("x-opencode-workspace") ?? undefined
      log.push({
        path: url.pathname,
        workspace,
      })

      if (url.pathname === "/config/providers") {
        return json({ providers: [], default: {} })
      }
      if (url.pathname === "/provider") {
        return json({ all: [], default: {}, connected: [] })
      }
      if (url.pathname === "/experimental/console") {
        return json({})
      }
      if (url.pathname === "/agent") {
        return json([])
      }
      if (url.pathname === "/config") {
        return json({})
      }
      if (url.pathname === "/project/current") {
        return json({ id: `proj-${workspace ?? "root"}` })
      }
      if (url.pathname === "/path") {
        return json({
          state: `/tmp/${workspace ?? "root"}/state`,
          config: `/tmp/${workspace ?? "root"}/config`,
          worktree: "/tmp/worktree",
          directory: `/tmp/${workspace ?? "root"}`,
        })
      }
      if (url.pathname === "/session") {
        return json([])
      }
      if (url.pathname === "/command") {
        return json([])
      }
      if (url.pathname === "/lsp") {
        return json([])
      }
      if (url.pathname === "/mcp") {
        return json({})
      }
      if (url.pathname === "/experimental/resource") {
        return json({})
      }
      if (url.pathname === "/formatter") {
        return json([])
      }
      if (url.pathname === "/session/status") {
        return json({})
      }
      if (url.pathname === "/provider/auth") {
        return json({})
      }
      if (url.pathname === "/vcs") {
        return json({ branch: "main" })
      }
      if (url.pathname === "/experimental/workspace") {
        return json([{ id: "ws_a" }, { id: "ws_b" }])
      }
      if (url.pathname === "/session/ses_1") {
        return json(data(workspace).session)
      }
      if (url.pathname === "/session/ses_1/message") {
        return json([data(workspace).message])
      }
      if (url.pathname === "/session/ses_1/todo") {
        return json(data(workspace).todo)
      }
      if (url.pathname === "/session/ses_1/diff") {
        return json(data(workspace).diff)
      }

      throw new Error(`unexpected request: ${req.method} ${url.pathname}`)
    },
    { preconnect: fetch.preconnect.bind(fetch) },
  ) satisfies typeof fetch
}

async function mount(log: Hit[]) {
  let project!: ReturnType<typeof useProject>
  let sync!: ReturnType<typeof useSync>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <SDKProvider
      url="http://test"
      directory="/tmp/root"
      fetch={createFetch(log)}
      events={{ subscribe: async () => () => {} }}
    >
      <ArgsProvider continue={false}>
        <ExitProvider>
          <ProjectProvider>
            <SyncProvider>
              <Probe
                onReady={(ctx) => {
                  project = ctx.project
                  sync = ctx.sync
                  done()
                }}
              />
            </SyncProvider>
          </ProjectProvider>
        </ExitProvider>
      </ArgsProvider>
    </SDKProvider>
  ))

  await ready
  return { app, project, sync }
}

async function waitBoot(log: Hit[], workspace?: string) {
  await wait(() => log.some((item) => item.path === "/experimental/workspace"))
  if (!workspace) return
  await wait(() => log.some((item) => item.path === "/project/current" && item.workspace === workspace))
}

function Probe(props: {
  onReady: (ctx: { project: ReturnType<typeof useProject>; sync: ReturnType<typeof useSync> }) => void
}) {
  const project = useProject()
  const sync = useSync()

  onMount(() => {
    props.onReady({ project, sync })
  })

  return <box />
}

describe("SyncProvider", () => {
  test("re-runs bootstrap requests when the active workspace changes", async () => {
    const log: Hit[] = []
    const { app, project } = await mount(log)

    try {
      await waitBoot(log)
      log.length = 0

      project.workspace.set("ws_a")

      await waitBoot(log, "ws_a")

      expect(log.some((item) => item.path === "/path" && item.workspace === "ws_a")).toBe(true)
      expect(log.some((item) => item.path === "/config" && item.workspace === "ws_a")).toBe(true)
      expect(log.some((item) => item.path === "/command" && item.workspace === "ws_a")).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })

  test("clears full-sync cache when the active workspace changes", async () => {
    const log: Hit[] = []
    const { app, project, sync } = await mount(log)

    try {
      await waitBoot(log)

      log.length = 0
      project.workspace.set("ws_a")
      await waitBoot(log, "ws_a")
      expect(project.workspace.current()).toBe("ws_a")

      log.length = 0
      await sync.session.sync("ses_1")

      expect(log.filter((item) => item.path === "/session/ses_1" && item.workspace === "ws_a")).toHaveLength(1)
      expect(sync.data.todo.ses_1[0]?.content).toBe("todo-ws_a")
      expect(sync.data.message.ses_1[0]?.id).toBe("msg_1")
      expect(sync.data.part.msg_1[0]).toMatchObject({ type: "text", text: "part-ws_a" })
      expect(sync.data.session_diff.ses_1[0]?.file).toBe("ws_a.ts")

      log.length = 0
      project.workspace.set("ws_b")
      await waitBoot(log, "ws_b")
      expect(project.workspace.current()).toBe("ws_b")

      log.length = 0
      await sync.session.sync("ses_1")
      await wait(() => log.some((item) => item.path === "/session/ses_1" && item.workspace === "ws_b"))

      expect(log.filter((item) => item.path === "/session/ses_1" && item.workspace === "ws_b")).toHaveLength(1)
      expect(sync.data.todo.ses_1[0]?.content).toBe("todo-ws_b")
      expect(sync.data.message.ses_1[0]?.id).toBe("msg_1")
      expect(sync.data.part.msg_1[0]).toMatchObject({ type: "text", text: "part-ws_b" })
      expect(sync.data.session_diff.ses_1[0]?.file).toBe("ws_b.ts")
    } finally {
      app.renderer.destroy()
    }
  })
})
