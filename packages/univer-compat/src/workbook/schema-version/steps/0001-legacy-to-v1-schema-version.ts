/**
 * Migration 0 → 1
 *
 * Introduces `schemaVersion` on the workbook object. All snapshots before this field
 * are treated as version 0 (missing or non-number). No other structural change.
 *
 * When adding 2 → 3, add a new file `0003-….ts`, register it in `run.ts`, and bump `latest.ts`.
 */
import type { WorkbookMigrationStep } from "../types"

export const step0001LegacyToV1: WorkbookMigrationStep = {
  from: 0,
  to: 1,
  migrate(wb) {
    wb.schemaVersion = 1
  },
}
