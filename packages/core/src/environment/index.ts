export * as Environment from "./index.js"

export { type Driver } from "./driver.js"
export {
  type DirEntry,
  Failed,
  type FileInfo,
  type Files,
  type FilesImpl,
  type FileType,
  NotFound,
  typeFollowing,
  WrongKind,
} from "./files.js"
export { execDefaults } from "./exec-defaults.js"
export { makeLocalDriver } from "./local.js"
export { makeMemoryDriver, type MemoryDriver } from "./memory.js"
export { type Interface, node, Service } from "./environment.js"

import type { Driver } from "./driver.js"
import { execDefaults } from "./exec-defaults.js"
import type { Files } from "./files.js"

export const makeFiles = (driver: Driver): Files => ({
  ...execDefaults(driver.spawner),
  ...driver.overrides,
})
