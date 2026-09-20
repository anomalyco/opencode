import type { SessionContext } from "@opencode/plugin/promise/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import path from "path"
import { resolveReportPrincipal, type SessionReader } from "./principal"

export const reportingSkillID = "superpowers-execution-reporting"
export const reportingSkillName = "Superpowers Execution Reporting"
export const reportingReminderMarker = "[superpowers-execution-reporting]"

const reportingSkillDescription =
  "Use when you are the root controller executing an approved Superpowers plan and should register or report task state, gates, and evidence through execution_report. Child sessions may read it but cannot report."

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
  const base = `${reportingReminderMarker} Root session ${input.rootSessionID} may load the ${reportingSkillID} skill when it executes an approved Superpowers plan: read the current run with execution_read, then report meaningful task transitions with execution_report. Do not create a run during brainstorming or merely because a session exists.`
  if (input.runID === undefined || input.revision === undefined) return base
  return `${base} Active run ${input.runID} is at revision ${input.revision}; call execution_read and reconcile before continuing.`
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
      text: reportingReminder({
        rootSessionID: resolved.value.rootSessionID,
        ...(run === undefined ? {} : { runID: run.runID, revision: run.revision }),
      }),
    })
  }
}

export function warnReportingDiagnostic(diagnostic: ReportingDiagnostic): void {
  console.warn("superpowers-execution reporting reminder skipped", diagnostic)
}
