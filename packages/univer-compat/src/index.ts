import { createCompatApp } from "./app"
import { exchangeFilesFromEnv } from "./exchange-files"
import { Store, unitStateKey } from "./store"

export { BlobMissing, exchangeFilesFromEnv, type ExchangeFileBackend, S3ExchangeFiles } from "./exchange-files"
export { applyMutationsToSnapshotJson } from "./apply-mutations"
export { createCompatApp, Store, unitStateKey }
export { universerRoutes, exchangeMultipartVsJson } from "./exchange-contract"
export { defaultWorkbook } from "./workbook"
export { xlsxToWorkbookJson } from "./xlsx-import"

export async function createDefaultCompatApp(opts?: { persistEveryRev?: number }) {
  const blob = exchangeFilesFromEnv()
  await blob.ensureReady()
  let step = opts?.persistEveryRev
  if (step === undefined) {
    const raw = process.env.UNIVER_COMPAT_PERSIST_EVERY_REV?.trim()
    if (!raw) throw new Error("UNIVER_COMPAT_PERSIST_EVERY_REV is required")
    step = Number.parseInt(raw, 10)
  }
  if (!Number.isFinite(step) || step < 1) throw new Error("UNIVER_COMPAT_PERSIST_EVERY_REV must be >= 1")
  return createCompatApp(new Store(blob, step))
}
