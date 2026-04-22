export async function bootstrapProjectTeams() {
  const [{ BugReportTranslate }, { MainPlanTranslate }, { MemoryTranslate }] = await Promise.all([
    import("@/team/bug-report-translate"),
    import("@/team/main-plan-translate"),
    import("@/team/memory-translate"),
  ])
  await BugReportTranslate.init()
  await MainPlanTranslate.init()
  await MemoryTranslate.init()
}
