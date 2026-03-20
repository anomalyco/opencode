import { runPromiseInstance } from "@/effect/runtime"
import { Format as S } from "./service"

export namespace Format {
  export const Status = S.Status
  export type Status = S.Status

  export type Interface = S.Interface

  export const Service = S.Service
  export const layer = S.layer

  export async function status() {
    return runPromiseInstance(S.Service.use((s) => s.status()))
  }
}
