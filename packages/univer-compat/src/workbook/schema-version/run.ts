import { plain } from "../util"
import { WORKBOOK_SCHEMA_VERSION } from "./latest"
import { step0001LegacyToV1 } from "./steps/0001-legacy-to-v1-schema-version"
import type { WorkbookMigrationStep } from "./types"

/** Workbook object inside a snapshot JSON root (either root itself or `root.workbook`). */
export function workbookBodyFromSnapshotRoot(root: Record<string, unknown>): Record<string, unknown> {
  const w = root.workbook
  if (plain(w)) return w
  return root
}

function readVersion(wb: Record<string, unknown>): number {
  const v = wb.schemaVersion
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0
  return Math.floor(v)
}

function assertChain(steps: readonly WorkbookMigrationStep[]) {
  let v = 0
  for (const s of steps) {
    if (s.from !== v) throw new Error(`workbook migrations: expected step from ${v}, got ${s.from}`)
    if (s.to !== v + 1) throw new Error(`workbook migrations: expected step to ${v + 1}, got ${s.to}`)
    v = s.to
  }
  if (v !== WORKBOOK_SCHEMA_VERSION) {
    throw new Error(`workbook migrations: chain ends at ${v} but WORKBOOK_SCHEMA_VERSION is ${WORKBOOK_SCHEMA_VERSION}`)
  }
}

/** Ordered single-step hops; extend when you add `steps/0002-….ts`. */
const STEPS: readonly WorkbookMigrationStep[] = [step0001LegacyToV1]

assertChain(STEPS)

/** Run migrations in order until `wb.schemaVersion === WORKBOOK_SCHEMA_VERSION` (mutates `wb`). */
export function migrateWorkbookToLatest(wb: Record<string, unknown>) {
  let v = readVersion(wb)
  while (v < WORKBOOK_SCHEMA_VERSION) {
    const step = STEPS.find((s) => s.from === v)
    if (!step) throw new Error(`workbook migrations: no step from schemaVersion ${v}`)
    step.migrate(wb)
    v = step.to
    wb.schemaVersion = v
  }
}

/** Call before persisting so stored JSON always carries the current version marker. */
export function stampWorkbookSchemaVersion(wb: Record<string, unknown>) {
  wb.schemaVersion = WORKBOOK_SCHEMA_VERSION
}

/** Migrate embedded workbook on an arbitrary snapshot root before `JSON.stringify` (mutates). */
export function migrateWorkbookInSnapshotRoot(root: Record<string, unknown>) {
  const wb = workbookBodyFromSnapshotRoot(root)
  migrateWorkbookToLatest(wb)
  stampWorkbookSchemaVersion(wb)
}
