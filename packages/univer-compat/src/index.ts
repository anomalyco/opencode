import { createCompatApp } from "./app"
import type { SessionResolver } from "@veritly/auth-shared"
import { workosCompatResolver } from "./compat-authenticator"
import { exchangeFilesFromEnv } from "./exchange-files"
import { Store, unitStateKey } from "./store"

export { BlobMissing, exchangeFilesFromEnv, type ExchangeFileBackend, S3ExchangeFiles } from "./exchange-files"
export { MemoryExchangeFiles } from "./memory-exchange-files"
export { headerTestCompatResolver, resolverAuthenticator, workosCompatResolver, type CompatAuthenticator } from "./compat-authenticator"
export { univerCompatHeaderTestUserAuthMiddleware, VERITLY_UNIVER_TEST_USER_HEADER } from "./auth-test-header"
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
  const blob = exchangeFilesFromEnv()
  await blob.ensureReady()
  let step = opts?.persistEveryRev
  if (step === undefined) {
    const raw = process.env.UNIVER_COMPAT_PERSIST_EVERY_REV?.trim()
    if (!raw) throw new Error("UNIVER_COMPAT_PERSIST_EVERY_REV is required")
    step = Number.parseInt(raw, 10)
  }
  if (!Number.isFinite(step) || step < 1) throw new Error("UNIVER_COMPAT_PERSIST_EVERY_REV must be >= 1")
  return createCompatApp(new Store(blob, step), auth)
}

export async function createDefaultCompatApp(opts?: { persistEveryRev?: number }) {
  return createCompatAppFromEnv(workosCompatResolver, opts)
}
