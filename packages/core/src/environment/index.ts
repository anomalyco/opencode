export * as Environment from "./index"

export { type Driver } from "./driver"
export {
  type DirEntry,
  Failed,
  type FileInfo,
  type Files,
  type FilesImpl,
  type FileType,
  NotFound,
  WrongKind,
} from "./files"
export { execDefaults } from "./exec-defaults"
export { makeLocalDriver } from "./local"
export { makeMemoryDriver, type MemoryDriver } from "./memory"
export { type Interface, node, Service } from "./environment"

import type { Driver } from "./driver"
import { execDefaults } from "./exec-defaults"
import type { Files } from "./files"

export const makeFiles = (driver: Driver): Files => ({
  ...execDefaults(driver.spawner),
  ...driver.overrides,
})
