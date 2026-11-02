import nodePath from "path"
import { customType } from "drizzle-orm/sqlite-core"
import { Schema } from "effect"
import { AbsolutePath } from "../schema.js"

function storagePath(input: string) {
  if (process.platform !== "win32") return input
  return input.replaceAll("\\", "/")
}

function isWindowsStoragePath(input: string) {
  return /^[A-Za-z]:\//.test(input) || input.startsWith("//")
}

export function storedAbsolutePath(input: string) {
  const result = storagePath(input)
  // Persisted projects and sessions can move between operating systems during migration.
  if (nodePath.posix.isAbsolute(result) || isWindowsStoragePath(result)) return result
  // A Windows path written with backslashes (e.g. `C:\...` or a `\\server\...`
  // UNC path left over on a non-Windows machine) is the same stored value as
  // its slash form, so normalize it instead of rejecting it: otherwise every
  // reader that decodes an absolute column (project list, sandboxes, the
  // archive sweep, sessions) fails on the whole result set for one bad row.
  if (/^[A-Za-z]:\\/.test(result) || result.startsWith("\\\\")) {
    const normalized = result.replaceAll("\\", "/")
    if (isWindowsStoragePath(normalized)) return normalized
  }
}

function absolute(input: string) {
  const result = storedAbsolutePath(input)
  if (result === undefined) throw new Error(`Path is not absolute: ${input}`)
  return result
}

function toPlatform(input: string) {
  if (process.platform !== "win32" || !isWindowsStoragePath(input)) return input
  return input.replaceAll("/", "\\")
}

export const absoluteColumn = customType<{
  data: AbsolutePath
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return absolute(input)
  },
  fromDriver(input) {
    return AbsolutePath.make(toPlatform(absolute(input)))
  },
})

// Legacy sessions may persist an empty directory. Keep that existing value
// readable while normalizing and validating every real directory.
export const directoryColumn = customType<{
  data: string
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return input ? absolute(input) : input
  },
  fromDriver(input) {
    return input ? toPlatform(absolute(input)) : input
  },
})

export const pathColumn = customType<{
  data: string
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return storagePath(input)
  },
  fromDriver(input) {
    return storagePath(input)
  },
})

const decodeAbsoluteArray = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))

export const absoluteArrayColumn = customType<{
  data: AbsolutePath[]
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return JSON.stringify(input.map(absolute))
  },
  fromDriver(input) {
    return decodeAbsoluteArray(input).map((item) => AbsolutePath.make(toPlatform(absolute(item))))
  },
})
