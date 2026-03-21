import { runPromiseInstance } from "@/effect/runtime"
import type { SessionID } from "@/session/schema"
import * as Mod from "./time-service"

const read = (sessionID: SessionID, file: string) => {
  return runPromiseInstance(Mod.FileTime.Service.use((s) => s.read(sessionID, file)))
}

const get = (sessionID: SessionID, file: string) => {
  return runPromiseInstance(Mod.FileTime.Service.use((s) => s.get(sessionID, file)))
}

const assert = async (sessionID: SessionID, filepath: string) => {
  return runPromiseInstance(Mod.FileTime.Service.use((s) => s.assert(sessionID, filepath)))
}

const withLock = async <T>(filepath: string, fn: () => Promise<T>): Promise<T> => {
  return runPromiseInstance(Mod.FileTime.Service.use((s) => s.withLock(filepath, fn)))
}

export const FileTime = {
  Service: Mod.FileTime.Service,
  layer: Mod.FileTime.layer,
  read,
  get,
  assert,
  withLock,
}

export namespace FileTime {
  export type Stamp = Mod.FileTime.Stamp
  export type Interface = Mod.FileTime.Interface
}
