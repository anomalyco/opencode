import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import {
  createExecutionTestHarness,
  EXECUTION_CHILD_SESSION,
  EXECUTION_ROOT_SESSION,
  EXECUTION_STRANGER_CHILD_SESSION,
  requireExplicitTestTarget,
  type ExecutionTestHarness,
} from "./execution-fixtures"

const target = requireExplicitTestTarget(process.env.EXECUTION_E2E_TARGET)

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
    await expect(page.locator('[data-slot="execution-mode-notice"]')).toHaveAttribute("data-mode", "incompatible")
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
          authorization: `Basic ${btoa(`opencode:${target?.password ?? ""}`)}`,
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

  test("a root whose recorded location changed is refused and keeps the stored run", async () => {
    const run = await execution.startRun()
    const before = await execution.readRun(run.runID)

    await execution.setSessions([
      { id: EXECUTION_ROOT_SESSION, directory: `${execution.owned.directories.root}/moved`, title: "Moved root" },
      {
        id: EXECUTION_CHILD_SESSION,
        parentID: EXECUTION_ROOT_SESSION,
        directory: execution.owned.directories.worktree,
        title: "Child",
      },
    ])

    const refused = await execution.report({
      operationID: "after-move",
      runID: run.runID,
      expectedRevision: before.revision,
      operation: { type: "task.state", taskID: "schema", attempt: 1, state: "running" },
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe("forbidden")

    const stored = await execution.rpc<typeof before>("getRun", {
      rootSessionID: run.rootSessionID,
      runID: run.runID,
    })
    expect(stored).toEqual(before)
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

  test("host logs and page URLs never contain the disposable credential", async ({ page }) => {
    const run = await execution.startRun()
    await execution.open(page, run)
    expect(page.url()).not.toContain("auth_token")

    const logs = execution.logs()
    expect(logs).not.toContain(target?.password ?? "unreachable")
    expect(logs).not.toContain(btoa(`opencode:${target?.password ?? ""}`))
    expect(logs.toLowerCase()).not.toContain("authorization")
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

  test("sanitized native fixtures match the host's actual API responses", async () => {
    const fixtures = JSON.parse(
      await readFile(new URL("./native-fixtures.json", import.meta.url), "utf8"),
    ) as {
      session: Record<string, unknown>
      sessionList: Record<string, unknown>
      active: unknown
      forms: unknown
      inbox: unknown
    }
    const owner = "<owner>"
    const normalize = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value)
          .replaceAll(execution.owned.directories.owner, owner)
          .replaceAll(execution.owned.directories.worktree, "<worktree>"),
      )

    const session = await execution.native(`/api/session/${EXECUTION_ROOT_SESSION}`)
    expect(normalize(session.body)).toEqual(fixtures.session)
    const list = await execution.native(`/api/session?parentID=${EXECUTION_ROOT_SESSION}`)
    expect(normalize(list.body)).toEqual(fixtures.sessionList)
    const active = await execution.native("/api/session/active")
    expect(normalize(active.body)).toEqual(fixtures.active)
    const forms = await execution.native(`/api/session/${EXECUTION_ROOT_SESSION}/form`)
    expect(normalize(forms.body)).toEqual(fixtures.forms)
    const inbox = await execution.native(`/api/session/${EXECUTION_ROOT_SESSION}/inbox`)
    expect(normalize(inbox.body)).toEqual(fixtures.inbox)
  })
})
