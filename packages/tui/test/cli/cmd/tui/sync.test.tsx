/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

describe("tui sync", () => {
  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount(undefined, tmp.path)

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/tui")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount(undefined, tmp.path)

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")
      emit(branchEvent("other", "ws_b"))
      await Bun.sleep(30)

      expect(sync.data.vcs?.branch).toBe("main")

      emit(branchEvent("feature", "ws_a"))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
    }
  })

  test("agent status settles before unrelated bootstrap requests", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let releaseAgents!: (response: Response) => void
    let releaseCommands!: (response: Response) => void
    const agents = new Promise<Response>((resolve) => {
      releaseAgents = resolve
    })
    const commands = new Promise<Response>((resolve) => {
      releaseCommands = resolve
    })
    const mounted = await mount(
      (url) => {
        if (url.pathname === "/agent") return agents
        if (url.pathname === "/command") return commands
      },
      tmp.path,
      { waitForComplete: false },
    )

    try {
      await wait(() => mounted.sync.status === "partial")
      expect(mounted.sync.data.agent_status).toBe("loading")

      releaseAgents(
        json([{ name: "build", mode: "primary", permission: {}, options: {} }]),
      )
      await wait(() => mounted.sync.data.agent_status === "complete")

      expect(mounted.sync.data.agent.map((agent) => agent.name)).toEqual(["build"])
      expect(mounted.sync.status).toBe("partial")

      releaseCommands(json([]))
      await wait(() => mounted.sync.status === "complete")
    } finally {
      releaseAgents(json([]))
      releaseCommands(json([]))
      mounted.app.renderer.destroy()
    }
  })

  test("older overlapping agent response cannot replace the latest request", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const requests: Array<{ promise: Promise<Response>; read: Promise<void>; resolve: (response: Response) => void }> = []
    const mounted = await mount(
      (url) => {
        if (url.pathname !== "/agent") return
        let resolveResponse!: (response: Response) => void
        let resolveRead!: () => void
        const promise = new Promise<Response>((done) => {
          resolveResponse = done
        })
        const read = new Promise<void>((done) => {
          resolveRead = done
        })
        requests.push({
          promise,
          read,
          resolve(response) {
            const text = response.text.bind(response)
            Object.defineProperty(response, "text", {
              value: async () => {
                const body = await text()
                setImmediate(resolveRead)
                return body
              },
            })
            resolveResponse(response)
          },
        })
        return promise
      },
      tmp.path,
      { waitForComplete: false },
    )

    try {
      await wait(() => requests.length === 1)
      void mounted.sync.bootstrap()
      await wait(() => requests.length === 2)

      requests[1]!.resolve(json([{ name: "current", mode: "primary", permission: {}, options: {} }]))
      await wait(() => mounted.sync.data.agent_status === "complete")
      expect(mounted.sync.data.agent.map((agent) => agent.name)).toEqual(["current"])

      requests[0]!.resolve(json([{ name: "stale", mode: "primary", permission: {}, options: {} }]))
      await requests[0]!.read
      expect(mounted.sync.data.agent.map((agent) => agent.name)).toEqual(["current"])
    } finally {
      for (const request of requests) request.resolve(json([]))
      mounted.app.renderer.destroy()
    }
  })

  test("empty agent response settles loading", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync } = await mount(undefined, tmp.path)

    try {
      expect(sync.data.agent).toEqual([])
      expect(sync.data.agent_status).toBe("complete")
    } finally {
      app.renderer.destroy()
    }
  })

  test("failed agent response remains unavailable without failing bootstrap", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const mounted = await mount(
      (url) => (url.pathname === "/agent" ? json({ error: "unavailable" }, { status: 500 }) : undefined),
      tmp.path,
      { waitForComplete: false },
    )

    try {
      await wait(() => mounted.sync.data.agent_status === "error")
      await wait(() => mounted.sync.status === "complete")
      expect(mounted.sync.data.agent).toEqual([])
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("a new bootstrap clears stale command and agent catalogs", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let agentRequests = 0
    let commandRequests = 0
    let releaseCommand!: (response: Response) => void
    const pendingCommand = new Promise<Response>((resolve) => (releaseCommand = resolve))
    const mounted = await mount((url) => {
      if (url.pathname === "/agent") {
        agentRequests++
        if (agentRequests === 1)
          return json([{ name: "stale", mode: "primary", permission: {}, options: {} }])
        return json({ error: "unavailable" }, { status: 500 })
      }
      if (url.pathname === "/command") {
        commandRequests++
        if (commandRequests === 1)
          return json([{ name: "stale", description: "stale", template: "", source: "command" }])
        return pendingCommand
      }
    }, tmp.path)

    try {
      expect(mounted.sync.data.agent.map((agent) => agent.name)).toEqual(["stale"])
      expect(mounted.sync.data.command.map((command) => command.name)).toEqual(["stale"])

      void mounted.sync.bootstrap()
      expect(mounted.sync.data.agent).toEqual([])
      expect(mounted.sync.data.command).toEqual([])
      await wait(() => mounted.sync.data.agent_status === "error")
      expect(mounted.sync.data.command_status).toBe("loading")

      releaseCommand(json([]))
      await wait(() => mounted.sync.data.command_status === "complete")
    } finally {
      releaseCommand(json([]))
      mounted.app.renderer.destroy()
    }
  })
})
