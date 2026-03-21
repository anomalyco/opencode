import type { Agent } from "@/agent/agent"
import { runPromise, Skill as S } from "./service"

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
    return runPromise((skill) => skill.get(name))
  }

  export async function all() {
    return runPromise((skill) => skill.all())
  }

  export async function dirs() {
    return runPromise((skill) => skill.dirs())
  }

  export async function available(agent?: Agent.Info) {
    return runPromise((skill) => skill.available(agent))
  }
}
