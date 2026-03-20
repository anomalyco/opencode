import { runPromiseInstance } from "@/effect/runtime"
import type { SessionID } from "@/session/schema"
import { FileTime as S } from "./time-service"

export namespace FileTime {
  export type Stamp = S.Stamp

  export type Interface = S.Interface

  export const Service = S.Service
  export const layer = S.layer

  export function read(sessionID: SessionID, file: string) {
    return runPromiseInstance(S.Service.use((s) => s.read(sessionID, file)))
  }

  export function get(sessionID: SessionID, file: string) {
    return runPromiseInstance(S.Service.use((s) => s.get(sessionID, file)))
  }

  export async function assert(sessionID: SessionID, filepath: string) {
    return runPromiseInstance(S.Service.use((s) => s.assert(sessionID, filepath)))
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    return runPromiseInstance(S.Service.use((s) => s.withLock(filepath, fn)))
  }
}
