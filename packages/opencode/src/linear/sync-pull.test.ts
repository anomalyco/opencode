import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { SyncPull } from "./sync-pull"
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

/** Build an MCP text response wrapping GraphQL issue data */
const issueRes = (nodes: unknown[], pageInfo?: { hasNextPage?: boolean; endCursor?: string }) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        data: {
          issues: {
            nodes,
            pageInfo: pageInfo ?? { hasNextPage: false },
          },
        },
      }),
    },
  ],
})

/** Build a minimal Linear issue node */
const makeIssue = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Issue ${id}`,
  description: `Description for ${id}`,
  priority: 2,
  state: { type: "unstarted" },
  teamId: "team_test",
  projectId: "proj_test",
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
    return Effect.succeed(r)
  }

  status = () => Effect.succeed("connected" as const)
  close = () => Effect.void
}

const makeTodoSvc = (store: Store, created: Todo.Info[] = []): Todo.Interface => ({
  get: () => Effect.succeed([...store]),
  create: (input: { sessionID: SessionID; todo: Todo.Info }) => {
    const todo = { ...input.todo, id: input.todo.id ?? "auto-" + crypto.randomUUID() }
    created.push(todo)
    return Effect.succeed(todo)
  },
  update: () => Effect.succeed(makeTodo("x")),
  replaceAll: () => Effect.void,
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

const emptyBus: Bus.Interface = {
  publish: () => Effect.void,
  subscribe: () => Effect.die("not implemented") as never,
  subscribeAll: () => Effect.die("not implemented") as never,
  subscribeCallback: () => Effect.succeed(() => {}),
  subscribeAllCallback: () => Effect.succeed(() => {}),
} as Bus.Interface

function provide(
  eff: Effect.Effect<SyncPull.Result, SyncPull.Error, LinearMcpClient | Todo.Service | Config.Service | Bus.Service>,
  client: FakeMcpClient,
  store: Store,
  created: Todo.Info[] = [],
  cfg?: Partial<Config.Linear>,
  bus?: Bus.Interface,
): Effect.Effect<SyncPull.Result> {
  return eff.pipe(
    Effect.provideService(SyncPull.Client, client as unknown as LinearMcpClient),
    Effect.provideService(Todo.Service, makeTodoSvc(store, created)),
    Effect.provideService(Config.Service, makeConfigSvc(cfg ?? {})),
    Effect.provideService(Bus.Service, bus ?? emptyBus),
  ) as Effect.Effect<SyncPull.Result>
}

describe("SyncPull.pull", () => {
  test("pull creates todos for new Linear issues", async () => {
    const client = new FakeMcpClient()
    client.setResponse(
      ISSUE.LIST,
      issueRes([
        makeIssue("LIN-1", { title: "Fix auth", priority: 2 }),
        makeIssue("LIN-2", { title: "Add tests", priority: 3 }),
      ]),
    )

    const store: Store = []
    const created: Todo.Info[] = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store, created),
    )

    expect(result.pulled).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.ids).toEqual(["LIN-1", "LIN-2"])

    expect(created.length).toBe(2)
    expect(created[0]!.title).toBe("Fix auth")
    expect(created[0]!.linear_issue_id).toBe("LIN-1")
    expect(created[0]!.priority).toBe("high")
    expect(created[0]!.status).toBe("pending")

    expect(created[1]!.title).toBe("Add tests")
    expect(created[1]!.linear_issue_id).toBe("LIN-2")
    expect(created[1]!.priority).toBe("medium")
    expect(created[1]!.status).toBe("pending")
  })

  test("pull skips existing issues with matching linear_issue_id", async () => {
    const client = new FakeMcpClient()
    client.setResponse(
      ISSUE.LIST,
      issueRes([
        makeIssue("LIN-1", { title: "Existing" }),
        makeIssue("LIN-2", { title: "New" }),
      ]),
    )

    const store: Store = [
      makeTodo("t1", { linear_issue_id: "LIN-1", title: "Existing" }),
    ]
    const created: Todo.Info[] = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store, created),
    )

    expect(result.pulled).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.ids).toEqual(["LIN-2"])

    expect(created.length).toBe(1)
    expect(created[0]!.linear_issue_id).toBe("LIN-2")
  })

  test("pull ignores completed and cancelled issues", async () => {
    const client = new FakeMcpClient()
    client.setResponse(
      ISSUE.LIST,
      issueRes([
        makeIssue("LIN-1", { title: "Active", state: { type: "started" } }),
        makeIssue("LIN-2", { title: "Done", state: { type: "completed" } }),
        makeIssue("LIN-3", { title: "Cancelled", state: { type: "cancelled" } }),
      ]),
    )

    const store: Store = []
    const created: Todo.Info[] = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store, created),
    )

    expect(result.pulled).toBe(1)
    expect(result.ids).toEqual(["LIN-1"])
    expect(created[0]!.status).toBe("in_progress")
  })

  test("pull throws SyncPull.Error when config missing projectId or teamId", async () => {
    const client = new FakeMcpClient()
    const store: Store = []

    const exit = await Effect.runPromiseExit(
      provide(
        SyncPull.pull({ sessionID: sid }),
        client,
        store,
        [],
        { projectId: undefined, teamId: undefined },
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const msg = Cause.pretty(exit.cause)
      expect(msg).toContain("missing projectId")
    }
  })

  test("pull handles pagination across multiple pages", async () => {
    const client = new FakeMcpClient()

    // First page: 2 issues with a next cursor
    client.setResponse(
      ISSUE.LIST,
      issueRes(
        [makeIssue("LIN-1"), makeIssue("LIN-2")],
        { hasNextPage: true, endCursor: "cursor-abc" },
      ),
    )

    // Override callTool to return different responses based on args
    const orig = client.callTool.bind(client) as typeof client.callTool
    client.callTool = (name: string, args: Record<string, unknown>) => {
      if (args.cursor === "cursor-abc") {
        return Effect.succeed(issueRes([makeIssue("LIN-3")]))
      }
      return orig(name, args)
    }

    const store: Store = []
    const created: Todo.Info[] = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store, created),
    )

    expect(result.pulled).toBe(3)
    expect(result.ids).toEqual(["LIN-1", "LIN-2", "LIN-3"])
    expect(created.length).toBe(3)
  })

  test("pull handles MCP errors gracefully — collects errors, continues", async () => {
    const client = new FakeMcpClient()
    client.setResponse(
      ISSUE.LIST,
      new LinearMcpError({ message: "MCP connection refused" }),
    )

    const store: Store = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store),
    )

    expect(result.pulled).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]!.linearIssueId).toBe("<batch>")
    expect(result.errors[0]!.error).toContain("MCP connection refused")
  })

  test("pull returns empty result when no issues match", async () => {
    const client = new FakeMcpClient()
    client.setResponse(ISSUE.LIST, issueRes([]))

    const store: Store = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store),
    )

    expect(result.pulled).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.ids).toEqual([])
  })
})

describe("SyncPull.mapStateToStatus", () => {
  test("maps all Linear state types to todo statuses", () => {
    expect(SyncPull.mapStateToStatus("unstarted")).toBe("pending")
    expect(SyncPull.mapStateToStatus("started")).toBe("in_progress")
    expect(SyncPull.mapStateToStatus("completed")).toBe("completed")
    expect(SyncPull.mapStateToStatus("canceled")).toBe("cancelled")
    expect(SyncPull.mapStateToStatus("cancelled")).toBe("cancelled")
  })

  test("handles edge cases — null, undefined, unknown", () => {
    expect(SyncPull.mapStateToStatus("unknown")).toBe("pending")
    expect(SyncPull.mapStateToStatus("")).toBe("pending")
  })
})

describe("SyncPull.mapReversePriority", () => {
  test("maps Linear priority numbers to strings", () => {
    expect(SyncPull.mapReversePriority(1)).toBe("urgent")
    expect(SyncPull.mapReversePriority(2)).toBe("high")
    expect(SyncPull.mapReversePriority(3)).toBe("medium")
    expect(SyncPull.mapReversePriority(4)).toBe("low")
  })

  test("maps 0 and other values to none", () => {
    expect(SyncPull.mapReversePriority(0)).toBe("none")
    expect(SyncPull.mapReversePriority(-1)).toBe("none")
    expect(SyncPull.mapReversePriority(99)).toBe("none")
  })
})

describe("SyncPull.pull (extended coverage)", () => {
  test("pull extracts labels from Linear issues", async () => {
    const client = new FakeMcpClient()
    client.setResponse(
      ISSUE.LIST,
      issueRes([
        makeIssue("LIN-10", {
          labels: { nodes: [{ name: "bug" }, { name: "frontend" }] },
        }),
      ]),
    )

    const store: Store = []
    const created: Todo.Info[] = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store, created),
    )

    expect(result.pulled).toBe(1)
    expect(result.ids).toEqual(["LIN-10"])
    expect(created[0]!.labels).toEqual(["bug", "frontend"])
  })

  test("pull handles non-GraphQL content structure gracefully", async () => {
    const client = new FakeMcpClient()
    client.setResponse(ISSUE.LIST, {
      content: [
        { type: "text", text: "not json" },
        { type: "text", text: JSON.stringify({}) },
        { type: "text", text: JSON.stringify({ data: { issues: {} } }) },
        {
          type: "text",
          text: JSON.stringify({
            data: { issues: { nodes: [makeIssue("LIN-11")] } },
          }),
        },
      ],
    })

    const store: Store = []
    const created: Todo.Info[] = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store, created),
    )

    expect(result.pulled).toBe(1)
    expect(created[0]!.linear_issue_id).toBe("LIN-11")
  })

  test("pull resolves parent issue reference from existing todos", async () => {
    const client = new FakeMcpClient()
    client.setResponse(
      ISSUE.LIST,
      issueRes([
        makeIssue("LIN-2", {
          title: "Sub task",
          parent: { id: "LIN-1" },
        }),
      ]),
    )

    const store: Store = [makeTodo("t1", { linear_issue_id: "LIN-1", title: "Parent" })]
    const created: Todo.Info[] = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store, created),
    )

    expect(result.pulled).toBe(1)
    expect(created[0]!.parent_id).toBe("t1")
  })

  test("pull returns empty when all issues have inactive states", async () => {
    const client = new FakeMcpClient()
    client.setResponse(
      ISSUE.LIST,
      issueRes([
        makeIssue("LIN-7", { state: { type: "completed" } }),
        makeIssue("LIN-8", { state: { type: "cancelled" } }),
      ]),
    )

    const store: Store = []
    const created: Todo.Info[] = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store, created),
    )

    expect(result.pulled).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.ids).toEqual([])
  })

  test("pull handles MCP response where no content matches GraphQL shape", async () => {
    const client = new FakeMcpClient()
    client.setResponse(ISSUE.LIST, {
      content: [
        { type: "text", text: JSON.stringify({ data: {} }) },
        { type: "text", text: JSON.stringify({ foo: "bar" }) },
      ],
    })

    const store: Store = []
    const created: Todo.Info[] = []

    const result = await Effect.runPromise(
      provide(SyncPull.pull({ sessionID: sid }), client, store, created),
    )

    expect(result.pulled).toBe(0)
    expect(result.ids).toEqual([])
  })


})

describe("SyncPull.subscribeAndResync", () => {
  test("subscribeAndResync runs without error", async () => {
    const result = await Effect.runPromise(SyncPull.subscribeAndResync(sid))
    expect(result).toBeUndefined()
  })
})
