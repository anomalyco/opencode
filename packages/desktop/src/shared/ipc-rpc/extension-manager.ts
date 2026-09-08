import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"

const Inventory = Schema.Array(ExtensionManager.Installed)
const Result = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), entries: Inventory }),
  Schema.Struct({ ok: Schema.Literal(false), error: ExtensionManager.Failure }),
])
export const ExtensionManagerRpcs = RpcGroup.make(
  Rpc.make("ExtensionManagerList", { success: Inventory }),
  Rpc.make("ExtensionManagerInstall", { payload: { data: Schema.Uint8Array }, success: Result }),
  Rpc.make("ExtensionManagerInstallURL", { payload: { url: Schema.String }, success: Result }),
  Rpc.make("ExtensionManagerEnable", { payload: { id: Schema.String, enabled: Schema.Boolean }, success: Result }),
  Rpc.make("ExtensionManagerReload", { payload: { id: Schema.String }, success: Result }),
  Rpc.make("ExtensionManagerSource", {
    payload: { id: Schema.String, revision: Schema.String },
    success: Schema.Union([
      Schema.Struct({ ok: Schema.Literal(true), value: ExtensionManager.Source }),
      Schema.Struct({ ok: Schema.Literal(false), error: ExtensionManager.Failure }),
    ]),
  }),
)
