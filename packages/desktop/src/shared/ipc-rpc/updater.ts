import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export const UpdaterStateSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("disabled") }),
  Schema.Struct({ status: Schema.Literal("idle") }),
  Schema.Struct({ status: Schema.Literal("checking") }),
  Schema.Struct({ status: Schema.Literal("downloading"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("ready"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("up-to-date") }),
  Schema.Struct({ status: Schema.Literal("installing"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
])

export const UpdaterSubscribe = Rpc.make("UpdaterSubscribe")
export const UpdaterUnsubscribe = Rpc.make("UpdaterUnsubscribe")
export const UpdaterCheck = Rpc.make("UpdaterCheck", { success: UpdaterStateSchema })
export const UpdaterInstall = Rpc.make("UpdaterInstall")
export const UpdaterRpcs = RpcGroup.make(UpdaterSubscribe, UpdaterUnsubscribe, UpdaterCheck, UpdaterInstall)
