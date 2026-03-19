import { Effect } from "effect"
import { Installation as S } from "./effect"
import { runtime } from "@/effect/runtime"

export namespace Installation {
  export type Method = S.Method
  export type Info = S.Info
  export type Interface = S.Interface
  export type UpgradeFailedError = S.UpgradeFailedError

  export const Event = S.Event
  export const Info = S.Info
  export const VERSION = S.VERSION
  export const CHANNEL = S.CHANNEL
  export const USER_AGENT = S.USER_AGENT
  export const isPreview = S.isPreview
  export const isLocal = S.isLocal
  export const UpgradeFailedError = S.UpgradeFailedError
  export const Service = S.Service
  export const layer = S.layer
  export const defaultLayer = S.defaultLayer

  function runPromise<A>(f: (service: S.Interface) => Effect.Effect<A, any>) {
    return runtime.runPromise(S.Service.use(f))
  }

  export function info(): Promise<Info> {
    return runPromise((svc) => svc.info())
  }

  export function method(): Promise<Method> {
    return runPromise((svc) => svc.method())
  }

  export function latest(installMethod?: Method): Promise<string> {
    return runPromise((svc) => svc.latest(installMethod))
  }

  export function upgrade(m: Method, target: string): Promise<void> {
    return runPromise((svc) => svc.upgrade(m, target))
  }
}
