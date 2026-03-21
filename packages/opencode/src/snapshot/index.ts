import { runPromiseInstance } from "@/effect/runtime"
import * as Snap from "./service"

const cleanup = async () => {
  return runPromiseInstance(Snap.Snapshot.Service.use((svc) => svc.cleanup()))
}

const track = async () => {
  return runPromiseInstance(Snap.Snapshot.Service.use((svc) => svc.track()))
}

const patch = async (hash: string) => {
  return runPromiseInstance(Snap.Snapshot.Service.use((svc) => svc.patch(hash)))
}

const restore = async (snapshot: string) => {
  return runPromiseInstance(Snap.Snapshot.Service.use((svc) => svc.restore(snapshot)))
}

const revert = async (patches: Snapshot.Patch[]) => {
  return runPromiseInstance(Snap.Snapshot.Service.use((svc) => svc.revert(patches)))
}

const diff = async (hash: string) => {
  return runPromiseInstance(Snap.Snapshot.Service.use((svc) => svc.diff(hash)))
}

const diffFull = async (from: string, to: string) => {
  return runPromiseInstance(Snap.Snapshot.Service.use((svc) => svc.diffFull(from, to)))
}

export const Snapshot = {
  Patch: Snap.Snapshot.Patch,
  FileDiff: Snap.Snapshot.FileDiff,
  Service: Snap.Snapshot.Service,
  layer: Snap.Snapshot.layer,
  defaultLayer: Snap.Snapshot.defaultLayer,
  cleanup,
  track,
  patch,
  restore,
  revert,
  diff,
  diffFull,
}

export namespace Snapshot {
  export type Patch = Snap.Snapshot.Patch
  export type FileDiff = Snap.Snapshot.FileDiff
  export type Interface = Snap.Snapshot.Interface
}
