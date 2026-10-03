import nodePath from "path"
import { customType } from "drizzle-orm/sqlite-core"
import { AbsolutePath } from "../schema"

function storagePath(input: string) {
  if (process.platform !== "win32") return input
  return input.replaceAll("\\", "/")
}

function isWindowsStoragePath(input: string) {
  return /^[A-Za-z]:\//.test(input) || input.startsWith("//")
}

function isAbsoluteStoragePath(input: string) {
  const result = storagePath(input)
  return nodePath.posix.isAbsolute(result) || (process.platform === "win32" && isWindowsStoragePath(result))
}

function absolute(input: string) {
  if (!isAbsoluteStoragePath(input)) throw new Error(`Path is not absolute: ${input}`)
  return storagePath(input)
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

// Legacy sessions may persist an empty directory or a value that is not a filesystem path at all —
// older web clients stored the session's own URL. Decoding runs per row, so one such value would
// abort the whole statement (a session list of any size would fail on that row). Keep those values
// readable as they are, while every real directory is still normalized and validated. Writes stay
// strict, so a value like this can no longer be stored.
function legacyDirectory(input: string) {
  if (!input) return input
  if (!isAbsoluteStoragePath(input)) return storagePath(input)
  return toPlatform(absolute(input))
}

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
    return legacyDirectory(input)
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
    return (JSON.parse(input) as string[]).map((item) => AbsolutePath.make(toPlatform(absolute(item))))
  },
})
