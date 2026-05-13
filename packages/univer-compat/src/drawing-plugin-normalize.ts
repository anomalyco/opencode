/** Stable subpath for the app; implementation lives under `workbook/`. */
export { applyMutationsToSnapshotJson } from "./workbook/apply-mutations"
export * from "./workbook/bootstrap"
export * from "./workbook/drawing-plugin"
export { openCompatDrawingDoc as parseDrawingDocForMerge } from "./workbook/drawing-plugin"
export * from "./workbook/parse-wire"
export * from "./workbook/schema-version"
export * from "./workbook/surface"
