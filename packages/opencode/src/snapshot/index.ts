import { runPromiseInstance } from "@/effect/runtime"
import { Snapshot as S } from "./service"

export namespace Snapshot {
  export const Patch = S.Patch
  export type Patch = S.Patch

  export const FileDiff = S.FileDiff
  export type FileDiff = S.FileDiff

  export type Interface = S.Interface

  export const Service = S.Service
  export const layer = S.layer
  export const defaultLayer = S.defaultLayer

  export async function cleanup() {
    return runPromiseInstance(S.Service.use((svc) => svc.cleanup()))
  }

  export async function track() {
    return runPromiseInstance(S.Service.use((svc) => svc.track()))
  }

  export async function patch(hash: string) {
    return runPromiseInstance(S.Service.use((svc) => svc.patch(hash)))
  }

  export async function restore(snapshot: string) {
    return runPromiseInstance(S.Service.use((svc) => svc.restore(snapshot)))
  }

  export async function revert(patches: Patch[]) {
    return runPromiseInstance(S.Service.use((svc) => svc.revert(patches)))
  }

  export async function diff(hash: string) {
    return runPromiseInstance(S.Service.use((svc) => svc.diff(hash)))
  }

  export async function diffFull(from: string, to: string) {
    return runPromiseInstance(S.Service.use((svc) => svc.diffFull(from, to)))
  }
}
