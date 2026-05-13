const OFFICE_PATH = /\.(xlsx|xlsm|xls|csv|docx|doc|odt|pptx|ppt|odp)$/i

export function isUniverOfficePath(workspaceRelativePath: string): boolean {
  return OFFICE_PATH.test(workspaceRelativePath)
}

export function officeMimeType(workspaceRelativePath: string): string {
  const p = workspaceRelativePath.toLowerCase()
  if (p.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  if (p.endsWith(".xlsm")) return "application/vnd.ms-excel.sheet.macroEnabled.12"
  if (p.endsWith(".xls") || p.endsWith(".xlsb")) return "application/vnd.ms-excel"
  if (p.endsWith(".csv")) return "text/csv"
  if (p.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (p.endsWith(".doc")) return "application/msword"
  if (p.endsWith(".odt")) return "application/vnd.oasis.opendocument.text"
  if (p.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  if (p.endsWith(".ppt")) return "application/vnd.ms-powerpoint"
  if (p.endsWith(".odp")) return "application/vnd.oasis.opendocument.presentation"
  return "application/octet-stream"
}
