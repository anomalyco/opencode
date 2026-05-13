export type WorkbookMigrationStep = {
  from: number
  to: number
  migrate: (wb: Record<string, unknown>) => void
}
