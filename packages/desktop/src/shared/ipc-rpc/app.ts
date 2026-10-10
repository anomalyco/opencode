import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

const ServerReadyData = Schema.Struct({
  url: Schema.String,
})

export class LocalServerPortConflict extends Schema.TaggedError<LocalServerPortConflict>()("LocalServerPortConflict", {
  hostname: Schema.String,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  message: Schema.String,
  details: Schema.optionalKey(Schema.String),
}) {}

export const AppAwaitInitialization = Rpc.make("AppAwaitInitialization", {
  success: ServerReadyData,
  error: LocalServerPortConflict,
})

export const AppReconnectService = Rpc.make("AppReconnectService", { success: ServerReadyData })

export const AppSetServicePort = Rpc.make("AppSetServicePort", {
  payload: { port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })) },
})

export const AppConsumeInitialDeepLinks = Rpc.make("AppConsumeInitialDeepLinks", {
  success: Schema.Array(Schema.String),
})

export const AppIsFirstLaunchOnboardingPending = Rpc.make("AppIsFirstLaunchOnboardingPending", {
  success: Schema.Boolean,
})

export const AppFinishFirstLaunchOnboarding = Rpc.make("AppFinishFirstLaunchOnboarding", {
  payload: { createDefaultProject: Schema.Boolean },
  success: Schema.NullOr(Schema.String),
})

export const AppCheckAppExists = Rpc.make("AppCheckAppExists", {
  payload: { appName: Schema.String },
  success: Schema.Boolean,
})

export const AppResolveAppPath = Rpc.make("AppResolveAppPath", {
  payload: { appName: Schema.String },
  success: Schema.NullOr(Schema.String),
})

export const AppSetBackgroundColor = Rpc.make("AppSetBackgroundColor", {
  payload: { color: Schema.String },
})

export const AppExportDebugLogs = Rpc.make("AppExportDebugLogs", { success: Schema.String })

export const AppSetForceFocus = Rpc.make("AppSetForceFocus", {
  payload: { enabled: Schema.Boolean },
})

export const AppRecordFatalRendererError = Rpc.make("AppRecordFatalRendererError", {
  payload: {
    error: Schema.Struct({
      error: Schema.String,
      url: Schema.String,
      version: Schema.optionalKey(Schema.String),
      platform: Schema.String,
      os: Schema.optionalKey(Schema.String),
    }),
  },
})

export const AppSetNativeTranslations = Rpc.make("AppSetNativeTranslations", {
  payload: { value: Schema.Unknown },
})

export const AppRelaunch = Rpc.make("AppRelaunch")

export const AppRpcs = RpcGroup.make(
  AppAwaitInitialization,
  AppReconnectService,
  AppSetServicePort,
  AppConsumeInitialDeepLinks,
  AppIsFirstLaunchOnboardingPending,
  AppFinishFirstLaunchOnboarding,
  AppCheckAppExists,
  AppResolveAppPath,
  AppSetBackgroundColor,
  AppExportDebugLogs,
  AppSetForceFocus,
  AppRecordFatalRendererError,
  AppSetNativeTranslations,
  AppRelaunch,
)
