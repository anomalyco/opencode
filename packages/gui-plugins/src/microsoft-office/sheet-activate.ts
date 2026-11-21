import type { SheetInfo, WorkbookHandle } from "@betteroffice/xlsx"
import { attempt } from "./sheet-cells"

/** The engine's active sheet as the workbook worker tracks it: the handle, and the metadata of its active sheet. */
export type ActiveSheet = {
  readonly workbook: Pick<WorkbookHandle, "setActiveSheet" | "sheetInfo">
  info: SheetInfo
}

/** Makes a sheet the active one, without reading its layout, and returns its metadata. */
export function activateSheet(target: ActiveSheet, sheet: number) {
  if (target.info.activeSheet === sheet) return target.info

  target.workbook.setActiveSheet(sheet)
  target.info = target.workbook.sheetInfo()

  return target.info
}

/**
 * Opens a sheet and reads what its grid needs with `read`. One sheet that fails to open leaves the others readable:
 * the sheet before it becomes active again, its metadata included, so the next pick recovers to it and not to the
 * sheet that failed. Undefined when the sheet could not open.
 */
export function showSheet<T>(target: ActiveSheet, sheet: number, read: (info: SheetInfo) => T): T | undefined {
  const previous = target.info
  const shown = attempt(() => read(activateSheet(target, sheet)))

  if (shown !== undefined) return shown

  target.info = previous
  attempt(() => target.workbook.setActiveSheet(previous.activeSheet))

  return undefined
}
