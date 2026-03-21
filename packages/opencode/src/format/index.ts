import { runPromiseInstance } from "@/effect/runtime"
import * as Mod from "./service"

const status = async () => {
  return runPromiseInstance(Mod.Format.Service.use((s) => s.status()))
}

export const Format = {
  Status: Mod.Format.Status,
  Service: Mod.Format.Service,
  layer: Mod.Format.layer,
  status,
}

export namespace Format {
  export type Status = Mod.Format.Status
  export type Interface = Mod.Format.Interface
}
