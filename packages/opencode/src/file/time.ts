import type { SessionID } from "@/session/schema"
import { runPromise, FileTime as S } from "./time-service"

export namespace FileTime {
  export type Stamp = S.Stamp

  export type Interface = S.Interface

  export const Service = S.Service
  export const layer = S.layer

  export function read(sessionID: SessionID, file: string) {
    return runPromise((s) => s.read(sessionID, file))
  }

  export function get(sessionID: SessionID, file: string) {
    return runPromise((s) => s.get(sessionID, file))
  }

  export async function assert(sessionID: SessionID, filepath: string) {
    return runPromise((s) => s.assert(sessionID, filepath))
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    return runPromise((s) => s.withLock(filepath, fn))
  }
}
