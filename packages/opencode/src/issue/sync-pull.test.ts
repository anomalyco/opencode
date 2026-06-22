import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Issue } from "../../src/issue/issue"
import { SyncPull } from "../../src/issue/sync-pull"
import { SyncPush } from "../../src/issue/sync-push"
import { LinearMcpClient, LinearMcpError } from "../../src/issue/mcp-client"
import { ISSUE } from "../../src/issue/tool-names"
import { Config } from "../../src/config/config"
import { Bus } from "../../src/bus"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"

const root = path.join(import.meta.dirname, "../..")
let dirCounter = 0
const freshDir = () => `/tmp/opencode-issue-test/${++dirCounter}-${Date.now()}`

const issueNode = (
  id: string,
  state: "unstarted" | "started" | "completed" | "canceled" = "unstarted",
  title = "Untitled",
): unknown => ({
  id,
  title,
  state: { type: state },
  priority: 0,
  labels: { nodes: [] },
})

const listRes = (nodes: unknown[], pageInfo?: { hasNextPage?: boolean; endCursor?: string }) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ data: { issues: { nodes, pageInfo } } }),
    },
  ],
})

const saveRes = (id: string) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ data: { saveIssue: { id } } }),
    },
  ],
})

class FakeMcpClient {
  responses: Map<string, unknown> = new Map()
  calls: Array<{ name: string; args: Record<string, unknown> }> = []

  setResponse(name: string, response: unknown) {
    this.responses.set(name, response)
  }

  callTool(name: string, args: Record<string, unknown>): Effect.Effect<unknown, LinearMcpError> {
    const self = this
    return Effect.gen(function* () {
      self.calls.push({ name, args })
      const res = self.responses.get(name)
      if (!res) return yield* Effect.fail(new LinearMcpError({ message: `no mock for ${name}` }))
      return res
    })
  }
}

const makeConfigService = (cfg: Partial<Config.Linear>): Config.Interface => ({
  get: () => Effect.succeed({ linear: { syncMode: "manual", autoPush: false, ...cfg } } as Config.Info),
  getGlobal: () => Effect.die("not implemented") as never,
  getConsoleState: () => Effect.die("not implemented") as never,
  installDependencies: () => Effect.void,
  update: () => Effect.void,
  updateGlobal: () => Effect.succeed({} as Config.Info),
  invalidate: () => Effect.void,
  directories: () => Effect.succeed([]),
  waitForDependencies: () => Effect.void,
})

async function withInstance<A>(fn: () => Promise<A>): Promise<A> {
  return Instance.provide({ directory: root, fn: () => AppRuntime.runPromise(Effect.promise(() => fn())) })
}

describe("SyncPull.pull", () => {
  test("inserts new issues; reports pulled/skipped honestly (no 'already up to date' label)", async () => {
    await withInstance(async () => {
      const client = new FakeMcpClient()
      client.setResponse(ISSUE.LIST, listRes([issueNode("lin-1"), issueNode("lin-2")]))
      const dir = freshDir()
      const result = await AppRuntime.runPromise(
        SyncPull.pull({ directory: dir }).pipe(
          Effect.provideService(SyncPull.Client, client as unknown as LinearMcpClient),
          Effect.provideService(Config.Service, makeConfigService({ projectId: "p", teamId: "t" })),
        ),
      )
      expect(result.pulled).toBe(2)
      expect(result.skipped).toBe(0)
      expect(result.failed).toBe(0)
      const list = await AppRuntime.runPromise(Issue.Service.use((svc) => svc.get({ directory: dir })))
      expect(list.length).toBe(2)
    })
  })

  test("skips issues already linked locally; does not overwrite local edits", async () => {
    await withInstance(async () => {
      const client = new FakeMcpClient()
      client.setResponse(
        ISSUE.LIST,
        listRes([
          issueNode("lin-1", "unstarted", "Remote title"),
          issueNode("lin-2", "started", "Second"),
        ]),
      )
      const dir = freshDir()
      await AppRuntime.runPromise(
        Issue.Service.use((svc) =>
          svc.create({
            directory: dir,
            issue: {
              content: "Local override",
              title: "Local override",
              status: "in_progress",
              priority: "high",
              linear_issue_id: "lin-1",
            },
          }),
        ),
      )
      const result = await AppRuntime.runPromise(
        SyncPull.pull({ directory: dir }).pipe(
          Effect.provideService(SyncPull.Client, client as unknown as LinearMcpClient),
          Effect.provideService(Config.Service, makeConfigService({ projectId: "p", teamId: "t" })),
        ),
      )
      expect(result.pulled).toBe(1)
      expect(result.skipped).toBe(1)
      const list = await AppRuntime.runPromise(Issue.Service.use((svc) => svc.get({ directory: dir })))
      const linked = list.find((i) => i.linear_issue_id === "lin-1")!
      expect(linked.title).toBe("Local override")
      const inserted = list.find((i) => i.linear_issue_id === "lin-2")!
      expect(inserted.status).toBe("in_progress")
    })
  })

  test("fails with SyncPull.Error when config missing projectId", async () => {
    await withInstance(async () => {
      const client = new FakeMcpClient()
      const exit = await AppRuntime.runPromise(
        SyncPull.pull({ directory: freshDir() }).pipe(
          Effect.provideService(SyncPull.Client, client as unknown as LinearMcpClient),
          Effect.provideService(Config.Service, makeConfigService({ teamId: "t" })),
          Effect.exit,
        ),
      )
      expect(exit._tag).toBe("Failure")
    })
  })
})

describe("SyncPush.push", () => {
  test("pushes only issues changed since last_pushed_at; idempotent", async () => {
    await withInstance(async () => {
      const client = new FakeMcpClient()
      client.setResponse(ISSUE.SAVE, saveRes("lin-1"))
      const cfgService = makeConfigService({ projectId: "p", teamId: "t" })
      const dir = freshDir()
      const created = await AppRuntime.runPromise(
        Issue.Service.use((svc) =>
          svc.create({
            directory: dir,
            issue: {
              content: "Title",
              title: "Title",
              status: "in_progress",
              priority: "high",
              linear_issue_id: "lin-1",
              linear_team_id: "t",
              linear_project_id: "p",
            },
          }),
        ),
      )
      const result = await AppRuntime.runPromise(
        SyncPush.push({ directory: dir }).pipe(
          Effect.provideService(SyncPush.Client, client as unknown as LinearMcpClient),
          Effect.provideService(Config.Service, cfgService),
        ),
      )
      expect(result.pushed).toBe(1)
      const result2 = await AppRuntime.runPromise(
        SyncPush.push({ directory: dir }).pipe(
          Effect.provideService(SyncPush.Client, client as unknown as LinearMcpClient),
          Effect.provideService(Config.Service, cfgService),
        ),
      )
      expect(result2.pushed).toBe(0)
      await AppRuntime.runPromise(
        Issue.Service.use((svc) =>
          svc.update({ directory: dir, id: created.id, patch: { status: "done" } }),
        ),
      )
      const result3 = await AppRuntime.runPromise(
        SyncPush.push({ directory: dir }).pipe(
          Effect.provideService(SyncPush.Client, client as unknown as LinearMcpClient),
          Effect.provideService(Config.Service, cfgService),
        ),
      )
      expect(result3.pushed).toBe(1)
    })
  })

  test("skips local-only issues (no linear_issue_id)", async () => {
    await withInstance(async () => {
      const client = new FakeMcpClient()
      const cfgService = makeConfigService({ projectId: "p", teamId: "t" })
      const dir = freshDir()
      await AppRuntime.runPromise(
        Issue.Service.use((svc) =>
          svc.create({
            directory: dir,
            issue: { content: "Local only", title: "Local only", status: "todo", priority: "low" },
          }),
        ),
      )
      const result = await AppRuntime.runPromise(
        SyncPush.push({ directory: dir }).pipe(
          Effect.provideService(SyncPush.Client, client as unknown as LinearMcpClient),
          Effect.provideService(Config.Service, cfgService),
        ),
      )
      expect(result.pushed).toBe(0)
      expect(client.calls.length).toBe(0)
    })
  })
})
