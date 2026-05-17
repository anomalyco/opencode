import { createCompatApp } from "./app"
import type { SessionResolver } from "@veritly/auth-shared"
import { workosCompatResolver } from "./compat-authenticator"
import { exchangeFilesFromEnv } from "./exchange-files"
import { Store, unitStateKey } from "./store"

export { BlobMissing, exchangeFilesFromEnv, type ExchangeFileBackend, S3ExchangeFiles } from "./exchange-files"
export { MemoryExchangeFiles } from "./memory-exchange-files"
export { resolverAuthenticator, workosCompatResolver, type CompatAuthenticator } from "./compat-authenticator"
export { isUniverCompatPublicPath } from "./compat-public-path"
export { unitBundleKey, unitBundlesPrefix, exchangeUploadKey, assertSafeUserSegment } from "./object-keys"
export { applyMutationsToSnapshotJson } from "./apply-mutations"
export { commitDrawingPluginInWorkbook, parseDrawingResourceBlob, parseWorkbookWire } from "./drawing-plugin-normalize"
export { createCompatApp, Store, unitStateKey }
export { universerRoutes, exchangeMultipartVsJson } from "./exchange-contract"
export { defaultWorkbook } from "./workbook"
export { xlsxToWorkbookJson } from "./xlsx-import"
export {
  WORKBOOK_SCHEMA_VERSION,
  migrateWorkbookInSnapshotRoot,
  migrateWorkbookToLatest,
  stampWorkbookSchemaVersion,
} from "./workbook"
export type { WorkbookMigrationStep } from "./workbook"

export async function createCompatAppFromEnv(auth: SessionResolver, opts?: { persistEveryRev?: number }) {
  const stamp = () => new Date().toISOString()
  console.error(`[univer-compat] ${stamp()} createCompatAppFromEnv: exchangeFilesFromEnv()`)
  const blob = exchangeFilesFromEnv()
  console.error(`[univer-compat] ${stamp()} createCompatAppFromEnv: ensureReady()…`)
  await blob.ensureReady()
  console.error(`[univer-compat] ${stamp()} createCompatAppFromEnv: ensureReady ok`)
  let step = opts?.persistEveryRev
  if (step === undefined) {
    const raw = process.env.UNIVER_COMPAT_PERSIST_EVERY_REV?.trim()
    if (!raw) throw new Error("UNIVER_COMPAT_PERSIST_EVERY_REV is required")
    step = Number.parseInt(raw, 10)
  }
  if (!Number.isFinite(step) || step < 1) throw new Error("UNIVER_COMPAT_PERSIST_EVERY_REV must be >= 1")
  console.error(`[univer-compat] ${stamp()} createCompatAppFromEnv: createCompatApp(Store, auth)…`)
  const out = createCompatApp(new Store(blob, step), auth)
  console.error(`[univer-compat] ${stamp()} createCompatAppFromEnv: done`)
  return out
}

export async function createDefaultCompatApp(opts?: { persistEveryRev?: number }) {
  return createCompatAppFromEnv(workosCompatResolver, opts)
}
