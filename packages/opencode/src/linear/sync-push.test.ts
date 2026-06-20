import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Stream } from "effect"
import { SyncPush } from "./sync-push"
import { LinearMcpClient, LinearMcpError } from "./mcp-client"
import { ISSUE } from "./tool-names"
import { Todo } from "@/session/todo"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { SessionID } from "@/session/schema"

const sid = "test-session" as SessionID

type Store = Todo.Info[]

const makeTodo = (id: string, overrides: Partial<Todo.Info> = {}): Todo.Info => ({
  id,
  level: 0,
  content: `Todo ${id}`,
  description: "",
  status: "pending",
  priority: "high",
  labels: [],
  ...overrides,
})

class FakeMcpClient {
  responses: Map<string, unknown> = new Map()
  calls: Array<{ name: string; args: Record<string, unknown> }> = []

  setResponse(name: string, response: unknown) {
    this.responses.set(name, response)
  }

  callTool(name: string, args: Record<string, unknown>): Effect.Effect<unknown, LinearMcpError> {
    this.calls.push({ name, args })
    const r = this.responses.get(name)
    if (r instanceof LinearMcpError) return Effect.fail(r)
    if (r instanceof Error) return Effect.fail(new LinearMcpError({ message: r.message, cause: r }))
    return Effect.succeed(r ?? {
      content: [{ type: "text", text: JSON.stringify({ id: "auto-" + crypto.randomUUID() }) }],
    })
  }

  status = () => Effect.succeed("connected" as const)
  close = () => Effect.void
}

const makeTodoSvc = (store: Store): Todo.Interface => ({
  get: () => Effect.succeed([...store]),
  update: (input: { sessionID: SessionID; id: string; patch: Partial<Todo.Info> }) => {
    const idx = store.findIndex((t) => t.id === input.id)
    if (idx === -1) return Effect.die(new Error(`Todo not found: ${input.id}`))
    if (input.patch.linear_issue_id !== undefined) {
      store[idx] = { ...store[idx]!, linear_issue_id: input.patch.linear_issue_id }
    }
    return Effect.succeed(store[idx]!)
  },
  replaceAll: () => Effect.void,
  create: () => Effect.succeed(makeTodo("new")),
  delete: () => Effect.void,
  patchStatus: () => Effect.succeed(makeTodo("x")),
  patchAssignee: () => Effect.succeed(makeTodo("x")),
  reorder: () => Effect.void,
  getTree: () => Effect.succeed([]),
}) as Todo.Interface

const makeConfigSvc = (cfg: Partial<Config.Linear>): Config.Interface => ({
  get: () =>
    Effect.succeed({
      linear: {
        projectId: cfg.projectId ?? "proj_test",
        teamId: cfg.teamId ?? "team_test",
        syncMode: (cfg.syncMode ?? "manual") as Config.Linear["syncMode"],
        autoPush: cfg.autoPush ?? false,
        ...cfg,
      },
      $schema: undefined,
    } as Config.Info),
  getGlobal: () => Effect.succeed({} as Config.Info),
  getConsoleState: () => Effect.die("not implemented"),
  installDependencies: () => Effect.void,
  update: () => Effect.void,
  updateGlobal: () => Effect.succeed({} as Config.Info),
  invalidate: () => Effect.void,
  directories: () => Effect.succeed([]),
  waitForDependencies: () => Effect.void,
}) as Config.Interface

const makeBusSvc = (events: Array<{ type: string; props: Record<string, unknown> }>): Bus.Interface => ({
  publish: (_def: unknown, props: unknown) => {
    events.push({ type: (_def as { type: string }).type, props: props as Record<string, unknown> })
    return Effect.void
  },
  subscribe: () => Stream.empty as never,
  subscribeAll: () => Stream.empty as never,
  subscribeCallback: () => Effect.succeed(() => {}),
  subscribeAllCallback: () => Effect.succeed(() => {}),
}) as Bus.Interface

const emptyBus = makeBusSvc([])

function provide(
  eff: Effect.Effect<SyncPush.Result, SyncPush.Error, LinearMcpClient | Todo.Service | Config.Service | Bus.Service>,
  client: FakeMcpClient,
  store: Store,
  cfg?: Partial<Config.Linear>,
  bus?: Bus.Interface,
): Effect.Effect<SyncPush.Result> {
  return eff.pipe(
    Effect.provideService(SyncPush.Client, client as unknown as LinearMcpClient),
    Effect.provideService(Todo.Service, makeTodoSvc(store)),
    Effect.provideService(Config.Service, makeConfigSvc(cfg ?? {})),
    Effect.provideService(Bus.Service, bus ?? emptyBus),
  ) as Effect.Effect<SyncPush.Result>
}

describe("SyncPush.push", () => {
  test("push a single todo — creates Linear issue, updates todo, publishes event", async () => {
    const client = new FakeMcpClient()
    client.setResponse(ISSUE.SAVE, {
      content: [{ type: "text", text: JSON.stringify({ data: { saveIssue: { id: "LIN-1" } } }) }],
    })

    const store: Store = [makeTodo("t1")]
    const events: Array<{ type: string; props: Record<string, unknown> }> = []

    const result = await Effect.runPromise(
      provide(SyncPush.push({ sessionID: sid }), client, store, {}, makeBusSvc(events)),
    )

    expect(result.pushed).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.ids).toEqual(["LIN-1"])
    expect(result.errors).toEqual([])

    expect(client.calls.length).toBe(1)
    expect(client.calls[0]!.name).toBe(ISSUE.SAVE)
    const args = client.calls[0]!.args as { input: Record<string, unknown> }
    expect(args.input.title).toBe("Todo t1")
    expect(args.input.teamId).toBe("team_test")
    expect(args.input.projectId).toBe("proj_test")

    expect(store[0]!.linear_issue_id).toBe("LIN-1")

    const updated = events.filter((e) => e.type === "todo.updated")
    expect(updated.length).toBeGreaterThanOrEqual(1)
  })

  test("push with todoIds 'all' — pushes all pending todos", async () => {
    const client = new FakeMcpClient()
    client.setResponse(ISSUE.SAVE, {
      content: [{ type: "text", text: JSON.stringify({ data: { saveIssue: { id: "LIN-2" } } }) }],
    })

    const store: Store = [makeTodo("t1"), makeTodo("t2"), makeTodo("t3")]

    const result = await Effect.runPromise(
      provide(SyncPush.push({ sessionID: sid, todoIds: "all" }), client, store),
    )

    expect(result.pushed).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.ids.length).toBe(3)
  })

  test("push with one MCP failure — collects error, others succeed", async () => {
    const client = new FakeMcpClient()
    let callCount = 0
    const orig = client.callTool.bind(client) as typeof client.callTool
    client.callTool = (name: string, args: Record<string, unknown>) => {
      callCount++
      if (callCount === 1) return Effect.fail(new LinearMcpError({ message: "MCP error" }))
      return orig(name, args)
    }

    const store: Store = [makeTodo("t1"), makeTodo("t2")]

    const result = await Effect.runPromise(
      provide(SyncPush.push({ sessionID: sid }), client, store),
    )

    expect(result.pushed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]!.id).toBe("t1")

    expect(store[1]!.linear_issue_id).toBeTruthy()
    expect(store[0]!.linear_issue_id).toBeFalsy()
  })

  test("push without projectId/teamId config — fails with clear error", async () => {
    const client = new FakeMcpClient()
    const store: Store = []

    const exit = await Effect.runPromiseExit(
      provide(
        SyncPush.push({ sessionID: sid }),
        client,
        store,
        { projectId: undefined, teamId: undefined },
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const msg = Cause.pretty(exit.cause)
      expect(msg).toContain("missing projectId")
    }
  })

  test("push skips todos with existing linear_issue_id", async () => {
    const client = new FakeMcpClient()
    client.setResponse(ISSUE.SAVE, {
      content: [{ type: "text", text: JSON.stringify({ data: { saveIssue: { id: "LIN-5" } } }) }],
    })

    const store: Store = [
      makeTodo("t1", { linear_issue_id: "LIN-existing" }),
      makeTodo("t2"),
    ]

    const result = await Effect.runPromise(
      provide(SyncPush.push({ sessionID: sid }), client, store),
    )

    expect(result.pushed).toBe(1)
    expect(client.calls.length).toBe(1)
    expect(store[0]!.linear_issue_id).toBe("LIN-existing")
    expect(store[1]!.linear_issue_id).toBe("LIN-5")
  })
})

describe("SyncPush.mapPriority", () => {
  test("maps todo priorities to Linear priority numbers", () => {
    expect(SyncPush.mapPriority("high")).toBe(2)
    expect(SyncPush.mapPriority("medium")).toBe(3)
    expect(SyncPush.mapPriority("low")).toBe(4)
    expect(SyncPush.mapPriority("urgent")).toBe(1)
    expect(SyncPush.mapPriority("none")).toBe(0)
    expect(SyncPush.mapPriority(undefined)).toBe(0)
  })
})

describe("SyncPush.mapTodoToIssue", () => {
  test("maps Todo.Info to Linear issue input", async () => {
    const todo = makeTodo("t1", {
      title: "Fix auth bug",
      content: "Fix the auth bug in login",
      description: "Detailed description",
      priority: "high",
      assignee_id: "user_1",
    })

    const cfg: Config.Linear = {
      projectId: "proj_1",
      teamId: "team_1",
      syncMode: "manual",
      autoPush: false,
    }

    const result = await Effect.runPromise(SyncPush.mapTodoToIssue(todo, cfg))

    expect(result.title).toBe("Fix auth bug")
    expect(result.description).toBe("Detailed description")
    expect(result.priority).toBe(2)
    expect(result.teamId).toBe("team_1")
    expect(result.projectId).toBe("proj_1")
    expect(result.assigneeId).toBe("user_1")
  })

  test("falls back to content when title is missing", async () => {
    const todo = makeTodo("t1", { title: undefined, content: "My content" })
    const cfg: Config.Linear = { projectId: "p1", teamId: "t1", syncMode: "manual", autoPush: false }

    const result = await Effect.runPromise(SyncPush.mapTodoToIssue(todo, cfg))
    expect(result.title).toBe("My content")
  })
})
