import { runPromiseInstance } from "@/effect/runtime"
import type { Agent } from "@/agent/agent"
import { Skill as S } from "./service"

export namespace Skill {
  export const Info = S.Info
  export type Info = S.Info

  export const InvalidError = S.InvalidError
  export const NameMismatchError = S.NameMismatchError

  export type Interface = S.Interface

  export const Service = S.Service
  export const layer = S.layer
  export const defaultLayer = S.defaultLayer

  export const fmt = S.fmt

  export async function get(name: string) {
    return runPromiseInstance(S.Service.use((skill) => skill.get(name)))
  }

  export async function all() {
    return runPromiseInstance(S.Service.use((skill) => skill.all()))
  }

  export async function dirs() {
    return runPromiseInstance(S.Service.use((skill) => skill.dirs()))
  }

  export async function available(agent?: Agent.Info) {
    return runPromiseInstance(S.Service.use((skill) => skill.available(agent)))
  }
}
