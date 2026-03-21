import { runPromiseInstance } from "@/effect/runtime"
import * as Mod from "./service"

const init = () => {
  return runPromiseInstance(Mod.File.Service.use((svc) => svc.init()))
}

const status = async () => {
  return runPromiseInstance(Mod.File.Service.use((svc) => svc.status()))
}

const read = async (file: string): Promise<File.Content> => {
  return runPromiseInstance(Mod.File.Service.use((svc) => svc.read(file)))
}

const list = async (dir?: string) => {
  return runPromiseInstance(Mod.File.Service.use((svc) => svc.list(dir)))
}

const search = async (input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) => {
  return runPromiseInstance(Mod.File.Service.use((svc) => svc.search(input)))
}

export const File = {
  Info: Mod.File.Info,
  Node: Mod.File.Node,
  Content: Mod.File.Content,
  Event: Mod.File.Event,
  Service: Mod.File.Service,
  layer: Mod.File.layer,
  init,
  status,
  read,
  list,
  search,
}

export namespace File {
  export type Info = Mod.File.Info
  export type Node = Mod.File.Node
  export type Content = Mod.File.Content
  export type Interface = Mod.File.Interface
}
