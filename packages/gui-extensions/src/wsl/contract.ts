import { Schema } from "effect"
import { Remote } from "../sdk"

export const WslServerConfig = Schema.Struct({ id: Schema.String, distro: Schema.String })
export type WslServerConfig = typeof WslServerConfig.Type
export const WslServerRuntime = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("starting") }),
  Schema.Struct({
    kind: Schema.Literal("ready"),
    url: Schema.String,
    password: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("failed"), message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("stopped") }),
])
export type WslServerRuntime = typeof WslServerRuntime.Type
export const WslJob = Schema.Union([
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
export type WslJob = typeof WslJob.Type
export const WslRuntimeCheck = Schema.Struct({
  available: Schema.Boolean,
  version: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
})
export type WslRuntimeCheck = typeof WslRuntimeCheck.Type
export const WslInstalledDistro = Schema.Struct({
  name: Schema.String,
  version: Schema.NullOr(Schema.Number),
  isDefault: Schema.Boolean,
})
export type WslInstalledDistro = typeof WslInstalledDistro.Type
export const WslOnlineDistro = Schema.Struct({ name: Schema.String, label: Schema.String })
export type WslOnlineDistro = typeof WslOnlineDistro.Type
export const WslDistroProbe = Schema.Struct({
  name: Schema.String,
  canExecute: Schema.Boolean,
  hasBash: Schema.Boolean,
  hasCurl: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
})
export type WslDistroProbe = typeof WslDistroProbe.Type
export const WslOpencodeCheck = Schema.Struct({
  distro: Schema.String,
  resolvedPath: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  expectedVersion: Schema.NullOr(Schema.String),
  matchesDesktop: Schema.NullOr(Schema.Boolean),
  error: Schema.NullOr(Schema.String),
})
export type WslOpencodeCheck = typeof WslOpencodeCheck.Type
export const WslServerItem = Schema.Struct({ config: WslServerConfig, runtime: WslServerRuntime })
export type WslServerItem = typeof WslServerItem.Type
export const WslServersState = Schema.Struct({
  runtime: Schema.NullOr(WslRuntimeCheck),
  installed: Schema.Array(WslInstalledDistro),
  online: Schema.Array(WslOnlineDistro),
  distroProbes: Schema.Record(Schema.String, WslDistroProbe),
  opencodeChecks: Schema.Record(Schema.String, WslOpencodeCheck),
  pendingRestart: Schema.Boolean,
  servers: Schema.Array(WslServerItem),
  job: Schema.NullOr(WslJob),
})
export type WslServersState = typeof WslServersState.Type

const Name = Schema.Struct({ name: Schema.NonEmptyString })
const Id = Schema.Struct({ id: Schema.NonEmptyString })

/** WSL runtime, distros, and the OpenCode servers the main process runs inside them. */
export const Wsl = Remote.define({
  id: "wsl",
  state: WslServersState,
  methods: {
    probeRuntime: {},
    refreshDistros: {},
    installWsl: {},
    installDistro: { input: Name },
    probeAddable: { input: Schema.Struct({ distros: Schema.Array(Schema.NonEmptyString) }) },
    installOpencode: { input: Name },
    addServer: { input: Schema.Struct({ distro: Schema.NonEmptyString }), output: WslServerConfig },
    removeServer: { input: Id },
    startServer: { input: Id },
  },
})
