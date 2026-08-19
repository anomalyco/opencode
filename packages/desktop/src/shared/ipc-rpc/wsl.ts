import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

const WslServerConfig = Schema.Struct({ id: Schema.String, distro: Schema.String })
const WslServerRuntime = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("starting") }),
  Schema.Struct({
    kind: Schema.Literal("ready"),
    url: Schema.String,
    username: Schema.NullOr(Schema.String),
    password: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("failed"), message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("stopped") }),
])
const WslJob = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("runtime"), startedAt: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("distros"), startedAt: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("install-wsl"), startedAt: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("install-distro"), distro: Schema.String, startedAt: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literal("probe-addable"),
    distros: Schema.Array(Schema.String),
    startedAt: Schema.Number,
  }),
  Schema.Struct({ kind: Schema.Literal("install-opencode"), distro: Schema.String, startedAt: Schema.Number }),
])
const WslServersState = Schema.Struct({
  runtime: Schema.NullOr(
    Schema.Struct({
      available: Schema.Boolean,
      version: Schema.NullOr(Schema.String),
      error: Schema.NullOr(Schema.String),
    }),
  ),
  installed: Schema.Array(
    Schema.Struct({ name: Schema.String, version: Schema.NullOr(Schema.Number), isDefault: Schema.Boolean }),
  ),
  online: Schema.Array(Schema.Struct({ name: Schema.String, label: Schema.String })),
  distroProbes: Schema.Record(
    Schema.String,
    Schema.Struct({
      name: Schema.String,
      canExecute: Schema.Boolean,
      hasBash: Schema.Boolean,
      hasCurl: Schema.Boolean,
      error: Schema.NullOr(Schema.String),
    }),
  ),
  opencodeChecks: Schema.Record(
    Schema.String,
    Schema.Struct({
      distro: Schema.String,
      resolvedPath: Schema.NullOr(Schema.String),
      version: Schema.NullOr(Schema.String),
      expectedVersion: Schema.NullOr(Schema.String),
      matchesDesktop: Schema.NullOr(Schema.Boolean),
      error: Schema.NullOr(Schema.String),
    }),
  ),
  pendingRestart: Schema.Boolean,
  servers: Schema.Array(Schema.Struct({ config: WslServerConfig, runtime: WslServerRuntime })),
  job: Schema.NullOr(WslJob),
})
export const WslServersEventSchema = Schema.Struct({ type: Schema.Literal("state"), state: WslServersState })

export const WslSubscribe = Rpc.make("WslSubscribe")
export const WslUnsubscribe = Rpc.make("WslUnsubscribe")
export const WslGetState = Rpc.make("WslGetState", { success: WslServersState })
export const WslProbeRuntime = Rpc.make("WslProbeRuntime")
export const WslRefreshDistros = Rpc.make("WslRefreshDistros")
export const WslInstallWsl = Rpc.make("WslInstallWsl")
export const WslInstallDistro = Rpc.make("WslInstallDistro", {
  payload: { name: Schema.String },
})
export const WslProbeAddable = Rpc.make("WslProbeAddable", {
  payload: { distros: Schema.Array(Schema.String) },
})
export const WslInstallOpencode = Rpc.make("WslInstallOpencode", {
  payload: { name: Schema.String },
})
export const WslOpenTerminal = Rpc.make("WslOpenTerminal", {
  payload: { name: Schema.String },
})
export const WslAddServer = Rpc.make("WslAddServer", {
  payload: { distro: Schema.String },
  success: WslServerConfig,
})
export const WslRemoveServer = Rpc.make("WslRemoveServer", {
  payload: { id: Schema.String },
})
export const WslStartServer = Rpc.make("WslStartServer", {
  payload: { id: Schema.String },
})
export const WslRpcs = RpcGroup.make(
  WslSubscribe,
  WslUnsubscribe,
  WslGetState,
  WslProbeRuntime,
  WslRefreshDistros,
  WslInstallWsl,
  WslInstallDistro,
  WslProbeAddable,
  WslInstallOpencode,
  WslOpenTerminal,
  WslAddServer,
  WslRemoveServer,
  WslStartServer,
)
