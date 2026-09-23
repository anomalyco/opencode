import { expect, test } from "bun:test"
import type { SessionContext } from "@opencode/plugin/promise/session"
import { createSessionReader } from "../src/principal"
import {
  containsReportingReminder,
  createReportingContextHook,
  reportingReminder,
  reportingReminderMarker,
  reportingSkillFile,
  type ReportingDiagnostic,
} from "../src/reporting"
import type { ReportCommand } from "../src/schema"
import { fixtureStart, reportingHarness, type ReportingHarness } from "./fixtures"

const owner = "/root/git/demo"
const controller = { sessionID: "root" }

async function startRun(harness: ReportingHarness, runID = "run-1") {
  return harness.callTool("execution_report", fixtureStart({ operationID: `start-${runID}`, runID }), controller)
}

test("reporting context is root-only and deduplicated", async () => {
  const harness = await reportingHarness()
  const child = harness.context("child")
  await harness.apply(child)
  expect(harness.hasReportingReminder(child)).toBe(false)
  const root = harness.context("root")
  await harness.apply(root)
  await harness.apply(root)
  expect(harness.reportingReminderCount(root)).toBe(1)
  expect(harness.historyWrites()).toBe(0)
})

test("the companion registers one uniquely named skill whose content is the packaged skill file", async () => {
  const harness = await reportingHarness()
  const skills = harness.skills()
  expect(skills).toHaveLength(1)
  const skill = skills[0]
  expect(String(skill.id)).toBe("superpowers-execution-reporting")
  expect(String(skill.name)).toBe("Superpowers Execution Reporting")
  expect(String(skill.path)).toBe(reportingSkillFile())
  expect(String(skill.path)).toContain("skills/superpowers-execution-reporting/SKILL.md")
  expect(skill.description).toContain("root controller")
  expect(skill.content).toBe(await Bun.file(reportingSkillFile()).text())
  for (const obligation of [
    "Before implementation or implementer dispatch",
    "compute its SHA-256",
    "call `execution_read`",
    "matching plan path and hash",
    "`execution_report`",
    "persisted response",
    "pause implementation",
    "cooperative safe stop",
    "UNRUN",
  ]) expect(skill.content).toContain(obligation)
  expect(skill.content).not.toContain("keep executing the plan")
  expect(skill.content).not.toContain("Continue the underlying Superpowers work")
})

test("the distributable controller rule pauses an unregistered plan", async () => {
  const readme = await Bun.file(new URL("../README.md", import.meta.url)).text()
  expect(readme).toContain("The rule applies even when reporting tools are missing")
  expect(readme).not.toContain("before activating the policy")
  const policy = readme.split("### Required global controller policy\n")[1]?.split("```text\n")[1]?.split("\n```")[0]
  expect(policy).toBeDefined()
  for (const obligation of [
    "approved Superpowers plan",
    "plan hash",
    "execution_read",
    "execution_report run.start",
    "complete graph, gates, and final review",
    "different plan",
    "until registration succeeds",
    "pause implementation",
    "cooperative safe stop",
    "After recovery",
  ]) expect(policy).toContain(obligation)
})

test("a read-only lookup reports no active run and never creates one", async () => {
  const harness = await reportingHarness()
  const context = harness.context("root")
  await harness.apply(context)
  expect(harness.reportingReminderCount(context)).toBe(1)
  expect(harness.reminders(context)[0]).toContain("Before implementing an approved Superpowers plan")
  expect(harness.reminders(context)[0]).toContain("execution_read")
  expect(harness.reminders(context)[0]).toContain("execution_report")
  expect(harness.reminders(context)[0]).toContain("pause")
  expect(harness.reminders(context)[0]).not.toContain("Active run")
  expect(harness.storage.writes()).toBe(0)

  const read = await harness.callTool<{ run: unknown }>("execution_read", {}, controller)
  expect(read.ok).toBe(true)
  if (!read.ok) return
  expect(read.value.run).toBeNull()
  expect(harness.storage.writes()).toBe(0)
  expect(harness.durableMessages()).toEqual([])
})

test("an active run is named with its revision and the reminder survives a later request after compaction", async () => {
  const harness = await reportingHarness()
  const started = await startRun(harness)
  expect(started.ok).toBe(true)

  const first = harness.context("root")
  await harness.apply(first)
  expect(harness.reminders(first)).toHaveLength(1)
  expect(harness.reminders(first)[0]).toContain("Active run run-1 is at revision 1")
  expect(harness.reminders(first)[0]).toContain("execution_read")
  expect(harness.reminders(first)[0]).toContain("reconcile")

  const compacted = harness.context("root", { system: [], messages: [] })
  await harness.apply(compacted)
  expect(harness.reminders(compacted)).toHaveLength(1)
  expect(harness.reminders(compacted)[0]).toContain("Active run run-1 is at revision 1")
  expect(harness.storage.writes()).toBe(1)
  expect(harness.historyWrites()).toBe(0)
})

test("applying the reminder to an active run performs no further durable write", async () => {
  const harness = await reportingHarness()
  await startRun(harness)
  const context = harness.context("root")
  await harness.apply(context)
  await harness.apply(context)
  expect(harness.storage.writes()).toBe(1)
  expect(harness.historyWrites()).toBe(0)
  expect(harness.durableMessages()).toEqual([])
})

test("a child session receives no controller bootstrap but can read the skill", async () => {
  const harness = await reportingHarness()
  await startRun(harness)
  const child = harness.context("child")
  await harness.apply(child)
  expect(harness.hasReportingReminder(child)).toBe(false)
  expect(harness.reminders(child)).toEqual([])
  expect(harness.skills().map((item) => String(item.id))).toContain("superpowers-execution-reporting")
  expect(harness.historyWrites()).toBe(0)
})

test("an inline root controller keeps the reminder while the root session is assigned", async () => {
  const harness = await reportingHarness()
  await startRun(harness)
  const command: ReportCommand = {
    operationID: "op-inline",
    runID: "run-1",
    expectedRevision: 1,
    operation: {
      type: "assignment.add",
      id: "a-inline",
      taskID: "task-a",
      attempt: 1,
      sessionID: "root",
      role: "controller",
    },
  }
  const assigned = await harness.callTool("execution_report", command, controller)
  expect(assigned.ok).toBe(true)

  const context = harness.context("root")
  await harness.apply(context)
  expect(harness.reminders(context)[0]).toContain("Active run run-1 is at revision 2")
  expect(harness.historyWrites()).toBe(0)
  expect(harness.durableMessages()).toEqual([])
})

test("existing Superpowers bootstrap and messages are preserved byte-for-byte", async () => {
  const harness = await reportingHarness()
  const bootstrap = { type: "text" as const, text: "<system-reminder>Superpowers bootstrap</system-reminder>" }
  const messages = [{ role: "user", content: [{ type: "text", text: "run the plan" }] }] as SessionContext["messages"]
  const context = harness.context("root", { system: [bootstrap], messages })
  const originalSystem = structuredClone(context.system)
  const originalMessages = structuredClone(context.messages)

  await harness.apply(context)

  expect(context.messages).toEqual(originalMessages)
  expect(context.system.slice(0, originalSystem.length)).toEqual(originalSystem)
  expect(context.system).toHaveLength(originalSystem.length + 1)
  expect(context.system.at(-1)?.text).toContain(reportingReminderMarker)
  expect(harness.historyWrites()).toBe(0)
  expect(harness.durableMessages()).toEqual([])
})

test("duplicate transforms do not duplicate the skill or the reminder", async () => {
  const harness = await reportingHarness()
  await harness.reapplySkillTransforms()
  await harness.reapplySkillTransforms()
  expect(harness.skills()).toHaveLength(1)

  const context = harness.context("root")
  await harness.apply(context)
  await harness.apply(context)
  expect(harness.reportingReminderCount(context)).toBe(1)
  expect(harness.historyWrites()).toBe(0)
})

test("a failed session lookup skips the reminder, reports a diagnostic, and retries later", async () => {
  const diagnostics: ReportingDiagnostic[] = []
  let failing = true
  const hook = createReportingContextHook({
    readSession: createSessionReader({
      get: async () => {
        if (failing) throw new Error("native session lookup failed")
        return { location: { directory: owner } }
      },
    }),
    readActiveRun: async () => undefined,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  })
  const harness = await reportingHarness()

  const failed = harness.context("root")
  await hook(failed)
  expect(containsReportingReminder(failed.system)).toBe(false)
  expect(diagnostics).toHaveLength(1)
  expect(diagnostics[0]?.code).toBe("session_lookup_failed")
  expect(diagnostics[0]?.sessionID).toBe("root")

  failing = false
  const recovered = harness.context("root")
  await hook(recovered)
  expect(containsReportingReminder(recovered.system)).toBe(true)
  expect(diagnostics).toHaveLength(1)
})

test("a lookup failure through the registered hook is not cached as a root decision", async () => {
  const harness = await reportingHarness()
  harness.failNextSessionGet()
  const failed = harness.context("root")
  await harness.apply(failed)
  expect(harness.hasReportingReminder(failed)).toBe(false)

  const recovered = harness.context("root")
  await harness.apply(recovered)
  expect(harness.hasReportingReminder(recovered)).toBe(true)
  expect(harness.historyWrites()).toBe(0)
})

test("the reminder is concise and asks for reconciliation only when a run exists", () => {
  const generic = reportingReminder({ rootSessionID: "root" })
  expect(generic).toContain(reportingReminderMarker)
  expect(generic).toContain("root")
  expect(generic).not.toContain("Active run")
  expect(generic).toContain("Do not create a run during brainstorming")

  const active = reportingReminder({ rootSessionID: "root", runID: "run-1", revision: 3 })
  expect(active).toContain("Active run run-1 is at revision 3")
  expect(active).toContain("reconcile")
})
