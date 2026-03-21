import { runPromiseInstance } from "@/effect/runtime"
import type { Agent } from "@/agent/agent"
import * as Mod from "./service"

const get = async (name: string) => {
  return runPromiseInstance(Mod.Skill.Service.use((skill) => skill.get(name)))
}

const all = async () => {
  return runPromiseInstance(Mod.Skill.Service.use((skill) => skill.all()))
}

const dirs = async () => {
  return runPromiseInstance(Mod.Skill.Service.use((skill) => skill.dirs()))
}

const available = async (agent?: Agent.Info) => {
  return runPromiseInstance(Mod.Skill.Service.use((skill) => skill.available(agent)))
}

export const Skill = {
  Info: Mod.Skill.Info,
  InvalidError: Mod.Skill.InvalidError,
  NameMismatchError: Mod.Skill.NameMismatchError,
  Service: Mod.Skill.Service,
  layer: Mod.Skill.layer,
  defaultLayer: Mod.Skill.defaultLayer,
  fmt: Mod.Skill.fmt,
  get,
  all,
  dirs,
  available,
}

export namespace Skill {
  export type Info = Mod.Skill.Info
  export type Interface = Mod.Skill.Interface
}
