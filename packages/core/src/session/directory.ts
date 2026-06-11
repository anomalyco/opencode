import { eq, sql, type SQL } from "drizzle-orm"
import { SessionTable } from "./sql"

export function isWindowsDirectory(directory: string) {
  return directory.length > 1 && (directory[1] === ":" || directory.startsWith("\\\\"))
}

export function normalizeSessionDirectory(directory: string) {
  if (isWindowsDirectory(directory)) return directory.replaceAll("\\", "/")
  return directory
}

export function directoryMatches(directory: string): SQL {
  if (!isWindowsDirectory(directory)) return eq(SessionTable.directory, directory)
  return sql`replace(${SessionTable.directory}, ${"\\"}, ${"/"}) = ${normalizeSessionDirectory(directory)}`
}

export * as SessionDirectory from "./directory"
