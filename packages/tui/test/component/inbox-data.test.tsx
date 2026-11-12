/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { useInbox } from "../../src/component/inbox-data"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { RouteProvider } from "../../src/context/route"
import { createApi, createEventStream, createFetch, directory, json, type FetchHandler } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"

function session(id: string, time: Partial<SessionInfo["time"]> = {}): SessionInfo {
  return {
    id,
    projectID: "project",
    title: id,
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 1, ...time },
  }
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 2_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Inbox did not reach expected state")
    await Bun.sleep(5)
  }
}

async function mount(fetch: FetchHandler) {
  const events = createEventStream()
  const calls = createFetch(fetch, events)
  let inbox!: ReturnType<typeof useInbox>
  function Probe() {
    inbox = useInbox()
    return <box />
  }
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ClientProvider api={createApi(calls.fetch)}>
          <DataProvider directory={directory}>
            <RouteProvider initialRoute={{ type: "session", sessionID: "recent-0" }}>
              <Probe />
            </RouteProvider>
          </DataProvider>
        </ClientProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
  )
  return {
    inbox,
    events,
    group: (title: string) => inbox.sections().find((section) => section.title === title)?.rows ?? [],
    [Symbol.dispose]: () => app.renderer.destroy(),
  }
}

test("loads root sessions across locations and moves a family as its child requests resolve", async () => {
  const root = { ...session("root", { busy: 5 }), location: { directory: "/other" } }
  const child = { ...session("child", { busy: 6 }), parentID: root.id, location: root.location }
  const recent = Array.from({ length: 11 }, (_, i) => session(`recent-${i}`, { idle: i, viewed: i }))
  const permission = Promise.withResolvers<Response>()
  const requests: URL[] = []
  using fixture = await mount((url) => {
    requests.push(url)
    if (url.pathname === "/api/session")
      return json({
        data: [
          root,
          child,
          session("archived", { archived: 3 }),
          { ...session("failed", { idle: 10 }), outcome: "failed" },
          session("done", { idle: 8 }),
          ...recent,
        ],
        cursor: {},
      })
    if (url.pathname === "/api/session/active") return json({ data: { child: { type: "running" } } })
    if (url.pathname === "/api/session/child") return json({ data: child })
    if (url.searchParams.get("location[directory]") !== root.location.directory) return
    if (url.pathname === "/api/permission/request") return permission.promise
    if (url.pathname === "/api/form")
      return json({
        data: [{ id: "form", sessionID: "child", title: "Answer", fields: [], metadata: { kind: "question" } }],
      })
  })
  const { events, group, inbox } = fixture
  await until(() => group("Needs attention")[0]?.detail === "Answer question")
  expect(inbox.loading()).toBe(false)
  permission.resolve(json({ data: [{ id: "permission", sessionID: "child", action: "read", resources: ["a"] }] }))
  await until(() => !inbox.loading() && group("Needs attention")[0]?.detail === "Review permission")
  expect(group("Needs attention")[0]).toMatchObject({ id: "root", directory: "/other", title: "root" })
  expect(inbox.sections().map((s) => s.title)).toEqual(["Needs attention", "Working", "Unread", "Recent"])
  expect(group("Recent").map((row) => row.id)).toEqual(recent.toReversed().map((s) => s.id))
  expect(group("Unread").map((row) => row.detail)).toEqual(["Failed", "Done"])
  expect(inbox.sections().flatMap((s) => s.rows)).toHaveLength(14)
  const index = requests.filter((url) => url.pathname === "/api/session")
  expect(index).toHaveLength(1)
  expect(index[0].searchParams.has("directory")).toBe(false)
  expect(index[0].searchParams.has("project")).toBe(false)

  events.emit({
    id: "reply",
    created: 7,
    type: "permission.replied",
    location: root.location,
    data: { sessionID: "child", requestID: "permission", reply: "once" },
  })
  await until(() => group("Needs attention")[0]?.detail === "Answer question")
  events.emit({
    id: "cancel",
    created: 8,
    type: "form.cancelled",
    location: root.location,
    data: { sessionID: "child", id: "form" },
  })
  await until(() => group("Working")[0]?.id === "root")
  events.emit({
    id: "archive",
    created: 9,
    type: "session.archived",
    location: root.location,
    durable: { aggregateID: "root", seq: 2, version: 1 },
    data: { sessionID: "root" },
  })
  await until(() => group("Working").length === 0)
  expect(
    inbox
      .sections()
      .flatMap((s) => s.rows)
      .some((row) => row.id === "root"),
  ).toBe(false)
  expect(requests.some((url) => url.pathname.includes("message"))).toBe(false)
})

test("a second location's cold form promotes an idle grandchild's root without scanning each session", async () => {
  const location = { directory: "/second" }
  const reads: string[] = []
  using fixture = await mount((url) => {
    reads.push(url.pathname)
    if (url.pathname === "/api/session")
      return json({
        data: [session("local"), { ...session("remote"), location }, { ...session("another"), location }],
        cursor: {},
      })
    if (url.pathname === "/api/form" && url.searchParams.get("location[directory]") === location.directory)
      return json({ location, data: [{ id: "pending", sessionID: "leaf", title: "Answer", fields: [] }] })
    if (url.pathname === "/api/session/leaf")
      return json({ data: { ...session("leaf"), location, parentID: "middle" } })
    if (url.pathname === "/api/session/middle")
      return json({ data: { ...session("middle"), location, parentID: "remote" } })
  })
  await until(() => fixture.group("Needs attention")[0]?.id === "remote")
  expect(fixture.group("Needs attention")).toEqual([
    { id: "remote", directory: "/second", title: "remote", detail: "Answer question" },
  ])
  expect(reads.filter((path) => path === "/api/form")).toHaveLength(2)
  expect(reads.filter((path) => path === "/api/permission/request")).toHaveLength(2)
  expect(reads.filter((path) => /^\/api\/session\/[^/]+\/(form|permission)$/.test(path))).toBeEmpty()
})

test("a delayed index cannot undo a live rename", async () => {
  const index = Promise.withResolvers<Response>()
  const requested = Promise.withResolvers<void>()
  using fixture = await mount((url) => {
    if (url.pathname === "/api/session") {
      requested.resolve()
      return index.promise
    }
    if (url.pathname === "/api/session/root") return json({ data: { ...session("root"), title: "New title" } })
  })
  await requested.promise
  fixture.events.emit({
    id: "rename",
    type: "session.renamed",
    created: 3,
    durable: { aggregateID: "root", seq: 1, version: 1 },
    data: { sessionID: "root", title: "New title" },
  })
  await until(() => fixture.group("Recent")[0]?.title === "New title")
  index.resolve(json({ data: [{ ...session("root"), title: "Old title" }, session("other")], cursor: {} }))
  await until(() => fixture.group("Recent").some((row) => row.id === "other"))
  expect(fixture.group("Recent").find((row) => row.id === "root")?.title).toBe("New title")
})
