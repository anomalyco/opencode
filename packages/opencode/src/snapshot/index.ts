import { runPromise, Snapshot as S } from "./service"

export namespace Snapshot {
  export const Patch = S.Patch
  export type Patch = S.Patch

  export const FileDiff = S.FileDiff
  export type FileDiff = S.FileDiff

  export type Interface = S.Interface

  export const Service = S.Service
  export const layer = S.layer
  export const defaultLayer = S.defaultLayer

  export async function init() {
    return runPromise((svc) => svc.init())
  }

  export async function cleanup() {
    return runPromise((svc) => svc.cleanup())
  }

  export async function track() {
    return runPromise((svc) => svc.track())
  }

  export async function patch(hash: string) {
    return runPromise((svc) => svc.patch(hash))
  }

  export async function restore(snapshot: string) {
    return runPromise((svc) => svc.restore(snapshot))
  }

  export async function revert(patches: Patch[]) {
    return runPromise((svc) => svc.revert(patches))
  }

  export async function diff(hash: string) {
    return runPromise((svc) => svc.diff(hash))
  }

  export async function diffFull(from: string, to: string) {
    return runPromise((svc) => svc.diffFull(from, to))
  }
}
