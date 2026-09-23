import type { SessionContext } from "@opencode/plugin/promise/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import path from "path"
import { resolveReportPrincipal, type SessionReader } from "./principal"

export const reportingSkillID = "superpowers-execution-reporting"
export const reportingSkillName = "Superpowers Execution Reporting"
export const reportingReminderMarker = "[superpowers-execution-reporting]"

const reportingSkillDescription =
  "Required for the root controller before executing an approved Superpowers plan: register or reconcile the run with execution_read and execution_report. Child sessions may read it but cannot report."

export function reportingSkillFile(): string {
  return path.join(import.meta.dir, "..", "skills", reportingSkillID, "SKILL.md")
}

export async function createReportingSkill(): Promise<Skill.Info> {
  const file = reportingSkillFile()
  return Skill.Info.make({
    id: Skill.ID.make(reportingSkillID),
    name: Skill.Name.make(reportingSkillName),
    description: reportingSkillDescription,
    path: AbsolutePath.make(file),
    content: await Bun.file(file).text(),
  })
}

export interface ActiveRun {
  readonly runID: string
  readonly revision: number
}

export interface ReportingReminderInput {
  readonly rootSessionID: string
  readonly runID?: string
  readonly revision?: number
}

export function reportingReminder(input: ReportingReminderInput): string {
  const base = `${reportingReminderMarker} Root controller ${input.rootSessionID}: The ${reportingSkillID} skill is already loaded below. Follow it directly; do not invoke the skill tool to load it again. Before implementation or implementer dispatch for an approved Superpowers plan, read the approved plan, compute its SHA-256 plan hash, and call execution_read. Reconcile only a matching plan path and hash, or persist execution_report run.start with the complete task graph, required gates, and final review. A run for a different plan is not a match. Do not begin plan work until registration succeeds. If the reporting skill, tools, or storage are unavailable, pause implementation and new dispatch, state the blocker, and allow only read-only diagnosis. If workers are already running, request a cooperative safe stop; do not claim they were automatically paused. After recovery, call execution_read and reconcile before resuming. Report real progress and evidence, verify each task only after its required gates pass, and finish only after final review. Never substitute a local ledger, badge, or capabilities response for persisted registration. Do not create a run during brainstorming or merely because a session exists.`
  if (input.runID === undefined || input.revision === undefined) return base
  return `${base} Active run ${input.runID} is at revision ${input.revision}; call execution_read and reconcile its plan before continuing.`
}

export function containsReportingReminder(system: ReadonlyArray<{ readonly text: string }>): boolean {
  return system.some((part) => part.text.includes(reportingReminderMarker))
}

export interface ReportingDiagnostic {
  readonly code: "session_lookup_failed"
  readonly sessionID: string
  readonly detail: string
}

export interface ReportingContextHookOptions {
  readonly skillContent: string
  readonly readSession: SessionReader
  readonly readActiveRun: (rootSessionID: string) => Promise<ActiveRun | undefined>
  readonly onDiagnostic: (diagnostic: ReportingDiagnostic) => void
}

export function createReportingContextHook(
  options: ReportingContextHookOptions,
): (context: SessionContext) => Promise<void> {
  return async (context) => {
    const resolved = await resolveReportPrincipal(context.sessionID, options.readSession)
    if (!resolved.ok) {
      options.onDiagnostic({
        code: "session_lookup_failed",
        sessionID: context.sessionID,
        detail: resolved.error.detail,
      })
      return
    }
    if (resolved.value.sessionID !== resolved.value.rootSessionID) return
    if (containsReportingReminder(context.system)) return
    const run = await options.readActiveRun(resolved.value.rootSessionID)
    context.system.push({
      type: "text",
      text: `${reportingReminder({
        rootSessionID: resolved.value.rootSessionID,
        ...(run === undefined ? {} : { runID: run.runID, revision: run.revision }),
      })}\n\n${options.skillContent}`,
    })
  }
}

export function warnReportingDiagnostic(diagnostic: ReportingDiagnostic): void {
  console.warn("superpowers-execution reporting reminder skipped", diagnostic)
}
