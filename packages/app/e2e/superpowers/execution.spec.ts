import { readFile } from "node:fs/promises"
import { base64Encode } from "@opencode/util/encode"
import { expect, test } from "@playwright/test"
import {
  createExecutionTestHarness,
  EXECUTION_CHILD_SESSION,
  EXECUTION_REVIEWER_SESSION,
  EXECUTION_ROOT_SESSION,
  EXECUTION_STRANGER_CHILD_SESSION,
  requireExplicitTestTarget,
  type ExecutionTestHarness,
} from "./execution-fixtures"

const target = requireExplicitTestTarget(process.env.EXECUTION_E2E_TARGET)

test.use({ trace: "off" })

test.describe("disposable execution target guards", () => {
  test("an unset target stays unconfigured instead of defaulting to a production service", () => {
    expect(requireExplicitTestTarget(undefined)).toBeUndefined()
    expect(requireExplicitTestTarget("")).toBeUndefined()
    expect(requireExplicitTestTarget("   ")).toBeUndefined()
  })

  test("a missing disposable marker is rejected", () => {
    expect(() => requireExplicitTestTarget(JSON.stringify({ directory: "/tmp/opencode/x", port: 4599 }))).toThrow(
      /explicitly disposable/,
    )
  })

  test("implicit or production directories and ports are rejected", () => {
    expect(() =>
      requireExplicitTestTarget(JSON.stringify({ disposable: true, directory: "relative/dir", port: 4599 })),
    ).toThrow(/absolute owned temporary directory/)
    expect(() =>
      requireExplicitTestTarget(JSON.stringify({ disposable: true, directory: "/root/git/opencode", port: 4599 })),
    ).toThrow(/owned directory under/)
    expect(() =>
      requireExplicitTestTarget(JSON.stringify({ disposable: true, directory: "/tmp/opencode/x" })),
    ).toThrow(/explicit disposable port/)
    expect(() =>
      requireExplicitTestTarget(JSON.stringify({ disposable: true, directory: "/tmp/opencode/x", port: 4096 })),
    ).toThrow(/managed service port/)
    expect(() =>
      requireExplicitTestTarget(JSON.stringify({ disposable: true, directory: "/tmp/opencode/x", port: 3000 })),
    ).toThrow(/app development port/)
    expect(() =>
      requireExplicitTestTarget(
        JSON.stringify({ disposable: true, directory: "/tmp/opencode/x", port: 4599, host: "opencode.ai" }),
      ),
    ).toThrow(/loopback disposable host/)
  })
})

test.describe("Superpowers execution bridge lifecycle", () => {
  test.skip(
    target === undefined,
    "UNRUN: EXECUTION_E2E_TARGET is not set. Set it to an explicitly disposable target (see docs/superpowers/verification/execution-ui/integration.md) to run this suite.",
  )

  let execution: ExecutionTestHarness

  test.beforeAll(async () => {
    if (target === undefined) return
    execution = createExecutionTestHarness(target)
    await execution.start()
  })

  test.afterAll(async () => {
    await execution?.stop()
  })

  test.beforeEach(async () => {
    await execution.reset()
    await execution.resetSessions()
  })

  test("durable run survives isolated host restart and missed invalidation", async ({ page }) => {
    const run = await execution.startRun()
    await execution.open(page, run)
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "ready")
    await execution.reportVerifiedTask(run, "schema")
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    await execution.disconnectDashboard(page)
    await execution.reportTaskState(run, "api", "running")
    const previousPid = execution.pid()
    const restarted = await execution.restartDisposableHost()
    expect(restarted.pid).not.toBe(previousPid)
    expect(restarted.process.pid).toBe(restarted.pid)
    await execution.reconnectDashboard(page, run)

    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")
    await expect(execution.task(page, "api")).toHaveAttribute("data-state", "running")
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "ready")
  })

  test("durable storage round-trips a run through a host restart", async () => {
    const run = await execution.startRun()
    await execution.reportVerifiedTask(run, "schema")

    const before = await execution.readRun(run.runID)
    expect(before.revision).toBeGreaterThan(1)
    expect(before.ownerDirectory).toBe(execution.owned.directories.owner)

    await execution.restartDisposableHost()

    const after = await execution.readRun(run.runID)
    expect(after).toEqual(before)
    const capabilities = await execution.rpc<{
      schemaVersion: number
      pluginVersion: string
      maxTasks: number
      reporting: string
    }>("capabilities", {})
    expect(capabilities).toEqual({ schemaVersion: 1, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" })
    const summaries = await execution.rpc<{ items: Array<{ runID: string; revision: number }> }>("getSummaries", {
      rootSessionIDs: [EXECUTION_ROOT_SESSION],
    })
    expect(summaries.items.map((item) => item.runID)).toEqual([run.runID])
  })

  test("a lost invalidation is recovered when the execution view becomes visible again", async ({ page }) => {
    const run = await execution.startRun()
    await execution.open(page, run)
    await execution.reportVerifiedTask(run, "schema")
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    await execution.suppressInvalidations(true)
    await execution.reportTaskState(run, "api", "running")
    await execution.hideExecution(page)
    await execution.showExecution(page)
    await expect(execution.task(page, "api")).toHaveAttribute("data-state", "running")
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "ready")
  })

  test("reporting the same operation twice is idempotent and does not advance the revision", async () => {
    const run = await execution.startRun()
    await execution.reportVerifiedTask(run, "schema")
    const before = await execution.readRun(run.runID)

    const command = {
      operationID: `state-api-${before.revision}`,
      runID: run.runID,
      expectedRevision: before.revision,
      operation: { type: "task.state" as const, taskID: "api", attempt: 1, state: "running" as const },
    }
    const first = await execution.report(command)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.duplicate).toBe(false)

    const second = await execution.report(command)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.duplicate).toBe(true)
    expect(second.value.run.revision).toBe(before.revision + 1)
    const stored = await execution.readRun(run.runID)
    expect(stored.revision).toBe(before.revision + 1)
  })

  test("a forced network interruption keeps the last snapshot instead of zeroing progress", async ({ page }) => {
    const run = await execution.startRun()
    await execution.open(page, run)
    await execution.reportVerifiedTask(run, "schema")
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    await page.route("**/api/rpc/**", (route) => route.abort("failed"))
    await execution.suppressInvalidations(true)
    await execution.reportTaskState(run, "api", "running")
    await execution.hideExecution(page)
    await execution.showExecution(page)
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "stale")
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    await page.unroute("**/api/rpc/**")
    await execution.suppressInvalidations(false)
    await execution.hideExecution(page)
    await execution.showExecution(page)
    await expect(execution.task(page, "api")).toHaveAttribute("data-state", "running")
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "ready")
  })

  test("an incompatible schema stays distinct and is not retried as an absent run", async ({ page }) => {
    const run = await execution.startRun()
    await execution.open(page, run)
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "ready")

    await execution.setCapabilityVersion(2)
    await execution.open(page, run)
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "incompatible")
    await expect(execution.modeNotice(page)).toHaveAttribute("data-mode", "incompatible")
  })

  test("malformed reports are rejected without changing durable state", async () => {
    const run = await execution.startRun()
    const before = await execution.readRun(run.runID)

    const malformed = await execution.reportRaw({
      operationID: "malformed",
      runID: run.runID,
      expectedRevision: before.revision,
      operation: { type: "task.state", taskID: "schema", attempt: 1, state: "nonsense" },
    })
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) expect(malformed.error.code).toBe("invalid_input")

    const stale = await execution.report({
      operationID: "stale-revision",
      runID: run.runID,
      expectedRevision: before.revision + 99,
      operation: { type: "task.state", taskID: "schema", attempt: 1, state: "running" },
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.code).toBe("revision_conflict")

    const stored = await execution.readRun(run.runID)
    expect(stored.revision).toBe(before.revision)
  })

  test("two independent hosts with identical identities never share state", async () => {
    const run = await execution.startRun()
    await execution.reportVerifiedTask(run, "schema")
    const primary = await execution.readRun(run.runID)

    const secondary = await execution.spawnSecondaryHost()
    try {
      expect(secondary.pid).not.toBe(execution.pid())
      const empty = await fetch(`${secondary.serverURL}/api/rpc/superpowers.execution.v1/getSummaries`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${base64Encode(`opencode:${target?.password ?? ""}`)}`,
        },
        body: JSON.stringify({ input: { rootSessionIDs: [EXECUTION_ROOT_SESSION] } }),
      })
      const body = (await empty.json()) as { output?: { items: unknown[] } }
      expect(body.output?.items).toEqual([])

      const stillPrimary = await execution.readRun(run.runID)
      expect(stillPrimary).toEqual(primary)
    } finally {
      await secondary.stop()
    }
  })

  test("switching to an identical-identity server does not leak the primary run", async ({ page }) => {
    const run = await execution.startRun()
    await execution.open(page, run)
    await execution.reportVerifiedTask(run, "schema")
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    const secondary = await execution.spawnSecondaryHost()
    try {
      expect(secondary.pid).not.toBe(execution.pid())
      const secondaryRun = await fetch(`${secondary.serverURL}/api/rpc/superpowers.execution.v1/getSummaries`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${base64Encode(`opencode:${target?.password ?? ""}`)}`,
        },
        body: JSON.stringify({ input: { rootSessionIDs: [EXECUTION_ROOT_SESSION] } }),
      })
      expect(((await secondaryRun.json()) as { output?: { items: unknown[] } }).output?.items).toEqual([])

      await page.addInitScript(
        ({ key, value }) => localStorage.setItem(key, value),
        {
          key: "opencode.global.dat:server",
          value: JSON.stringify({
            list: [{ type: "http", http: { url: secondary.serverURL, password: target?.password } }],
            hidden: {},
            projects: {},
            lastProject: {},
            recentlyClosed: {},
          }),
        },
      )
      await page.goto(execution.sessionHref(EXECUTION_ROOT_SESSION, secondary.serverURL))
      await execution.openPanel(page)
      await expect(execution.panel(page)).toHaveAttribute("data-mode", "observer")
      await expect(page.locator('[data-testid="execution-map-node"]')).toHaveCount(0)

      await page.goto(execution.sessionHref(EXECUTION_ROOT_SESSION))
      await execution.openPanel(page)
      await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")
      await expect(execution.panel(page)).toHaveAttribute("data-mode", "ready")
    } finally {
      await secondary.stop()
    }
  })

  test("a child in another worktree is accepted while the owner location is unchanged", async () => {
    const run = await execution.startRun()
    const current = await execution.readRun(run.runID)
    const assignment = await execution.report({
      operationID: "assign-worktree-child",
      runID: run.runID,
      expectedRevision: current.revision,
      operation: {
        type: "assignment.add",
        id: "as-worktree",
        taskID: "schema",
        attempt: 1,
        sessionID: EXECUTION_CHILD_SESSION,
        role: "implementer",
      },
    })
    expect(assignment.ok).toBe(true)
    if (!assignment.ok) return
    const stored = await execution.readRun(run.runID)
    expect(stored.ownerDirectory).toBe(execution.owned.directories.owner)
    expect(stored.assignments).toHaveLength(1)
    expect(stored.assignments[0]?.sessionID).toBe(EXECUTION_CHILD_SESSION)

    const reviewer = await execution.report({
      operationID: "assign-reviewer",
      runID: run.runID,
      expectedRevision: stored.revision,
      operation: {
        type: "assignment.add",
        id: "as-reviewer",
        taskID: "review",
        attempt: 1,
        sessionID: EXECUTION_CHILD_SESSION,
        role: "debugger",
      },
    })
    expect(reviewer.ok).toBe(true)
  })

  test("a root location change pauses tracking through the app and retains the reported run", async ({ page }) => {
    const run = await execution.startRun()
    await execution.open(page, run)
    await execution.reportVerifiedTask(run, "schema")
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    const moved = `${execution.owned.directories.root}/moved-owner`
    const before = await execution.readRun(run.runID)
    await execution.setSessions([
      { id: EXECUTION_ROOT_SESSION, directory: moved, title: "Execution root", running: true },
      {
        id: EXECUTION_CHILD_SESSION,
        parentID: EXECUTION_ROOT_SESSION,
        directory: execution.owned.directories.worktree,
        title: "Feature worktree child",
      },
      { id: EXECUTION_REVIEWER_SESSION, parentID: EXECUTION_ROOT_SESSION, directory: moved, title: "Reviewer" },
    ])
    await execution.emitNativeEvent({
      id: "evt_move_root",
      created: Date.now(),
      type: "session.moved",
      location: { directory: moved },
      data: { sessionID: EXECUTION_ROOT_SESSION, location: { directory: moved }, projectID: "project" },
    })

    await execution.openPanel(page)
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "stale")
    await expect(execution.modeNotice(page)).toHaveAttribute("data-reason", "location_changed")
    await expect(execution.modeNotice(page)).toContainText("owner location changed")
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    const refused = await execution.report({
      operationID: "after-move",
      runID: run.runID,
      expectedRevision: before.revision,
      operation: { type: "task.state", taskID: "schema", attempt: 1, state: "running" },
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe("forbidden")
  })

  test("a cancelled run stays terminal and never reports completion", async () => {
    const run = await execution.startRun()
    await execution.reportVerifiedTask(run, "schema")
    const cancelled = await execution.cancelRun(run)
    expect(cancelled.run.status).toBe("cancelled")

    const current = await execution.readRun(run.runID)
    const rejected = await execution.report({
      operationID: "after-cancel",
      runID: run.runID,
      expectedRevision: current.revision,
      operation: { type: "task.state", taskID: "api", attempt: 1, state: "running" },
    })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error.code).toBe("invalid_transition")

    const summaries = await execution.rpc<{ items: Array<{ runID: string; status: string }> }>("getSummaries", {
      rootSessionIDs: [EXECUTION_ROOT_SESSION],
    })
    expect(summaries.items[0]?.status).toBe("cancelled")
  })

  test("unloading and reloading the plugin returns to observer mode and recovers the stored run", async ({ page }) => {
    const run = await execution.startRun()
    await execution.reportVerifiedTask(run, "schema")
    await execution.open(page, run)
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    await execution.unloadPlugin()
    await execution.open(page, run)
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "observer")

    await execution.reloadPlugin()
    await execution.open(page, run)
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")
  })

  test("a child session navigates on the same server and keeps the root run association", async ({ page }) => {
    const run = await execution.startRun()
    await execution.open(page, run)
    await execution.reportVerifiedTask(run, "schema")
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    await execution.selectSubview(page, "Agents")
    const openChild = execution.agentOpen(page, "Feature worktree child")
    await expect(openChild).toBeVisible()
    await openChild.click()
    await expect.poll(() => page.url()).toContain(execution.sessionHref(EXECUTION_CHILD_SESSION))

    await execution.openPanel(page)
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")
    await expect(execution.panel(page)).toHaveAttribute("data-mode", "ready")
  })

  test("no captured request URL or retained artifact contains the disposable credential", async ({ page }, testInfo) => {
    const run = await execution.startRun()
    const urls: string[] = []
    page.on("request", (request) => urls.push(request.url()))
    await execution.open(page, run)
    await execution.reportVerifiedTask(run, "schema")
    await expect(execution.task(page, "schema")).toHaveAttribute("data-state", "verified")

    const password = target?.password ?? "unreachable"
    const encoded = base64Encode(`opencode:${password}`)
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url).not.toContain(password)
      expect(url).not.toContain(encoded)
      expect(url).not.toContain("auth_token")
    }
    expect(page.url()).not.toContain(password)
    expect(page.url()).not.toContain(encoded)

    await testInfo.attach("execution-credential-page", { body: await page.screenshot(), contentType: "image/png" })

    expect(execution.logs()).not.toContain(password)
    expect(execution.logs()).not.toContain(encoded)
    expect(execution.owned.process.pid).not.toBe(process.pid)
  })

  test("a report referencing a session outside the run is refused", async () => {
    const run = await execution.startRun()
    const before = await execution.readRun(run.runID)
    const assignment = await execution.report({
      operationID: "assign-stranger",
      runID: run.runID,
      expectedRevision: before.revision,
      operation: {
        type: "assignment.add",
        id: "as-stranger",
        taskID: "schema",
        attempt: 1,
        sessionID: EXECUTION_STRANGER_CHILD_SESSION,
        role: "implementer",
      },
    })
    expect(assignment.ok).toBe(false)
    if (!assignment.ok) expect(assignment.error.code).toBe("forbidden")

    const evidence = await execution.report({
      operationID: "evidence-stranger",
      runID: run.runID,
      expectedRevision: before.revision,
      operation: {
        type: "evidence.add",
        id: "ev-stranger",
        taskID: "schema",
        attempt: 1,
        gate: "tests",
        outcome: "passed",
        summary: "should be refused",
        sessionID: EXECUTION_STRANGER_CHILD_SESSION,
        messageID: "msg-stranger",
      },
    })
    expect(evidence.ok).toBe(false)
    if (!evidence.ok) expect(evidence.error.code).toBe("forbidden")

    const stored = await execution.readRun(run.runID)
    expect(stored).toEqual(before)
  })

  test("recorded native host fixtures expose the adapter contract the stand-in also serves", async () => {
    const recorded = JSON.parse(
      await readFile(new URL("./native-host-fixtures.json", import.meta.url), "utf8"),
    ) as {
      sessions: {
        get: unknown
        list: unknown
        children: unknown
        active: unknown
        forms: unknown
        inbox: unknown
        messages: unknown
      }
    }

    expectSessionContract(recorded.sessions.get)
    expectSessionListContract(recorded.sessions.list)
    expectSessionListContract(recorded.sessions.children)
    expectActiveContract(recorded.sessions.active)
    expectListContract(recorded.sessions.forms)
    expectListContract(recorded.sessions.inbox)
    expectSessionListContract(recorded.sessions.messages)

    expectSessionContract((await execution.native(`/api/session/${EXECUTION_ROOT_SESSION}`)).body)
    expectSessionListContract((await execution.native("/api/session")).body)
    expectSessionListContract((await execution.native(`/api/session?parentID=${EXECUTION_ROOT_SESSION}`)).body)
    expectActiveContract((await execution.native("/api/session/active")).body)
    expectListContract((await execution.native(`/api/session/${EXECUTION_ROOT_SESSION}/form`)).body)
    expectListContract((await execution.native(`/api/session/${EXECUTION_ROOT_SESSION}/inbox`)).body)
  })
})

function expectSessionContract(body: unknown) {
  const data = (body as { data: Record<string, unknown> }).data
  expect(typeof data.id).toBe("string")
  expect(typeof data.title).toBe("string")
  expect(typeof (data.location as { directory: unknown }).directory).toBe("string")
  expect(typeof (data.time as { created: unknown }).created).toBe("number")
  expect(typeof (data.time as { updated: unknown }).updated).toBe("number")
}

function expectSessionListContract(body: unknown) {
  const data = (body as { data: unknown[] }).data
  expect(Array.isArray(data)).toBe(true)
  expect((body as { cursor: unknown }).cursor).toBeDefined()
  for (const item of data) expectSessionContract({ data: item })
}

function expectListContract(body: unknown) {
  expect(Array.isArray((body as { data: unknown[] }).data)).toBe(true)
}

function expectActiveContract(body: unknown) {
  expect(typeof (body as { data: unknown }).data).toBe("object")
}
