import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SyncPush } from "./sync-push"
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
const issueRes = (
  nodes: unknown[],
  pageInfo?: { hasNextPage?: boolean; endCursor?: string },
) => ({
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

/** Build a minimal Linear issue node matching the GraphQL shape */
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

/** Tool names we expect listTools to return */
const EXPECTED_TOOLS = [
  ISSUE.GET,
  ISSUE.LIST,
  ISSUE.SAVE,
  ISSUE.LIST_STATUSES,
  ISSUE.GET_STATUS,
  ISSUE.LIST_LABELS,
  ISSUE.CREATE_LABEL,
  "list_comments",
  "save_comment",
  "delete_comment",
  "get_user",
  "list_users",
  "get_team",
  "list_teams",
  "list_projects",
  "list_cycles",
]

class FakeMcpClient {
  responses: Map<string, unknown> = new Map()
  calls: Array<{ name: string; args: Record<string, unknown> }> = []

  setResponse(name: string, response: unknown) {
    this.responses.set(name, response)
  }

  listTools(): Effect.Effect<Array<{ name: string }>, LinearMcpError> {
    return Effect.succeed(EXPECTED_TOOLS.map((name) => ({ name })))
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Effect.Effect<unknown, LinearMcpError> {
    this.calls.push({ name, args })
    const r = this.responses.get(name)
    if (r instanceof LinearMcpError) return Effect.fail(r)
    if (r instanceof Error)
      return Effect.fail(new LinearMcpError({ message: r.message, cause: r }))
    return Effect.succeed(
      r ?? {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              data: { saveIssue: { id: "auto-" + crypto.randomUUID() } },
            }),
          },
        ],
      },
    )
  }

  status = () => Effect.succeed("connected" as const)
  close = () => Effect.void
}

const makeTodoSvc = (store: Store): Todo.Interface => ({
  get: () => Effect.succeed([...store]),
  create: (input: { sessionID: SessionID; todo: Todo.Info }) => {
    const todo = {
      ...input.todo,
      id: input.todo.id ?? "auto-" + crypto.randomUUID(),
    }
    store.push(todo)
    return Effect.succeed(todo)
  },
  update: (input: {
    sessionID: SessionID
    id: string
    patch: Partial<Todo.Info>
  }) => {
    const idx = store.findIndex((t) => t.id === input.id)
    if (idx === -1) return Effect.die(new Error(`Todo not found: ${input.id}`))
    store[idx] = { ...store[idx]!, ...input.patch }
    return Effect.succeed(store[idx]!)
  },
  replaceAll: () => Effect.void,
  delete: () => Effect.void,
  patchStatus: () => Effect.succeed(makeTodo("x")),
  patchAssignee: () => Effect.succeed(makeTodo("x")),
  reorder: () => Effect.void,
  getTree: () => Effect.succeed([]),
}) as Todo.Interface

const makeConfigSvc = (
  cfg: Partial<Config.Linear> = {},
): Config.Interface => ({
  get: () =>
    Effect.succeed({
      linear: {
        projectId: "proj_test",
        teamId: "team_test",
        syncMode: "manual" as const,
        autoPush: false,
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

function providePush(
  eff: Effect.Effect<
    SyncPush.Result,
    SyncPush.Error,
    LinearMcpClient | Todo.Service | Config.Service | Bus.Service
  >,
  client: FakeMcpClient,
  store: Store,
  cfg?: Partial<Config.Linear>,
  bus?: Bus.Interface,
): Effect.Effect<SyncPush.Result> {
  return eff.pipe(
    Effect.provideService(
      SyncPush.Client,
      client as unknown as LinearMcpClient,
    ),
    Effect.provideService(Todo.Service, makeTodoSvc(store)),
    Effect.provideService(Config.Service, makeConfigSvc(cfg ?? {})),
    Effect.provideService(Bus.Service, bus ?? emptyBus),
  ) as Effect.Effect<SyncPush.Result>
}

function providePull(
  eff: Effect.Effect<
    SyncPull.Result,
    SyncPull.Error,
    LinearMcpClient | Todo.Service | Config.Service | Bus.Service
  >,
  client: FakeMcpClient,
  store: Store,
  cfg?: Partial<Config.Linear>,
  bus?: Bus.Interface,
): Effect.Effect<SyncPull.Result> {
  return eff.pipe(
    Effect.provideService(
      SyncPull.Client,
      client as unknown as LinearMcpClient,
    ),
    Effect.provideService(Todo.Service, makeTodoSvc(store)),
    Effect.provideService(Config.Service, makeConfigSvc(cfg ?? {})),
    Effect.provideService(Bus.Service, bus ?? emptyBus),
  ) as Effect.Effect<SyncPull.Result>
}

// ─── Test Scenarios ────────────────────────────────────────────────

describe("Linear MCP Integration", () => {
  test("1: listTools returns expected Linear tool names", async () => {
    const client = new FakeMcpClient()
    const tools = await Effect.runPromise(client.listTools())

    expect(tools.length).toBe(16)
    const names = tools.map((t) => t.name)
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected)
    }
  })

  test("2: push 3 todos creates 3 Linear issues", async () => {
    const client = new FakeMcpClient()
    client.setResponse(ISSUE.SAVE, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            data: { saveIssue: { id: "LIN-42" } },
          }),
        },
      ],
    })

    const store: Store = [makeTodo("t1"), makeTodo("t2"), makeTodo("t3")]

    const result = await Effect.runPromise(
      providePush(
        SyncPush.push({ sessionID: sid, todoIds: "all" }),
        client,
        store,
      ),
    )

    expect(result.pushed).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.ids.length).toBe(3)
    expect(client.calls.length).toBe(3)
    expect(client.calls.every((c) => c.name === ISSUE.SAVE)).toBe(true)
    // All 3 todos now have a linear_issue_id
    expect(store.filter((t) => t.linear_issue_id).length).toBe(3)
  })

  test("3: pull 5 Linear issues creates 5 todos", async () => {
    const client = new FakeMcpClient()
    client.setResponse(
      ISSUE.LIST,
      issueRes([
        makeIssue("LIN-1"),
        makeIssue("LIN-2"),
        makeIssue("LIN-3"),
        makeIssue("LIN-4"),
        makeIssue("LIN-5"),
      ]),
    )

    const store: Store = []

    const result = await Effect.runPromise(
      providePull(SyncPull.pull({ sessionID: sid }), client, store),
    )

    expect(result.pulled).toBe(5)
    expect(result.failed).toBe(0)
    expect(result.ids).toEqual([
      "LIN-1",
      "LIN-2",
      "LIN-3",
      "LIN-4",
      "LIN-5",
    ])
    expect(store.length).toBe(5)
    // All created todos should have linear_issue_id set
    expect(store.every((t) => t.linear_issue_id)).toBe(true)
  })

  test("4: push then pull cycle avoids duplicates", async () => {
    const client = new FakeMcpClient()
    const pushIds = ["LIN-1", "LIN-2", "LIN-3"]
    let pushIdx = 0

    // Override callTool: SAVE returns unique IDs, LIST returns matching issues
    const origCall = client.callTool.bind(client)
    client.callTool = (name: string, args: Record<string, unknown>) => {
      client.calls.push({ name, args })
      if (name === ISSUE.SAVE) {
        const id = pushIds[pushIdx++]
        return Effect.succeed({
          content: [
            {
              type: "text",
              text: JSON.stringify({ data: { saveIssue: { id } } }),
            },
          ],
        })
      }
      if (name === ISSUE.LIST) {
        return Effect.succeed(
          issueRes([
            makeIssue("LIN-1"),
            makeIssue("LIN-2"),
            makeIssue("LIN-3"),
          ]),
        )
      }
      return origCall(name, args)
    }

    const store: Store = [makeTodo("t1"), makeTodo("t2"), makeTodo("t3")]

    // Step 1: Push 3 todos → creates Linear issues
    const pushResult = await Effect.runPromise(
      providePush(
        SyncPush.push({ sessionID: sid, todoIds: "all" }),
        client,
        store,
      ),
    )
    expect(pushResult.pushed).toBe(3)
    expect(pushResult.failed).toBe(0)
    expect(store.filter((t) => t.linear_issue_id).length).toBe(3)

    // Step 2: Pull back the same 3 issues → should skip all (already synced)
    const pullResult = await Effect.runPromise(
      providePull(SyncPull.pull({ sessionID: sid }), client, store),
    )

    expect(pullResult.pulled).toBe(0)
    expect(pullResult.skipped).toBe(3)
    expect(pullResult.failed).toBe(0)
    // No new todos were created
    expect(store.length).toBe(3)
  })

  test("5: MCP disconnect during push collects all errors gracefully", async () => {
    const client = new FakeMcpClient()

    // Override callTool to always fail
    client.callTool = () =>
      Effect.fail(
        new LinearMcpError({ message: "Connection refused by MCP server" }),
      )

    const store: Store = [makeTodo("t1"), makeTodo("t2"), makeTodo("t3")]

    const result = await Effect.runPromise(
      providePush(
        SyncPush.push({ sessionID: sid, todoIds: "all" }),
        client,
        store,
      ),
    )

    expect(result.pushed).toBe(0)
    expect(result.failed).toBe(3)
    expect(result.errors.length).toBe(3)
    expect(result.errors.every((e) => !!e.id)).toBe(true)
    // No partial state: no linear_issue_id was set on any todo
    expect(store.every((t) => !t.linear_issue_id)).toBe(true)
  })
})
