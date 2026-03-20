import { runPromiseInstance } from "@/effect/runtime"
import { File as S } from "./service"

export namespace File {
  export const Info = S.Info
  export type Info = S.Info

  export const Node = S.Node
  export type Node = S.Node

  export const Content = S.Content
  export type Content = S.Content

  export const Event = S.Event

  export type Interface = S.Interface

  export const Service = S.Service
  export const layer = S.layer

  export function init() {
    return runPromiseInstance(S.Service.use((svc) => svc.init()))
  }

  export async function status() {
    return runPromiseInstance(S.Service.use((svc) => svc.status()))
  }

  export async function read(file: string): Promise<Content> {
    return runPromiseInstance(S.Service.use((svc) => svc.read(file)))
  }

  export async function list(dir?: string) {
    return runPromiseInstance(S.Service.use((svc) => svc.list(dir)))
  }

  export async function search(input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) {
    return runPromiseInstance(S.Service.use((svc) => svc.search(input)))
  }
}
