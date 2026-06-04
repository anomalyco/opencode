import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { NonNegativeInt, optionalOmitUndefined } from "@opencode-ai/core/schema"
import {
  UiAppSettingsTable,
  UiKeybindTable,
  UiModelPreferenceTable,
  UiModelRecentTable,
  UiModelVariantTable,
  UiSettingsProfileTable,
} from "@opencode-ai/core/ui/settings.sql"
import { Context, Effect, Layer, Schema } from "effect"
import { GlobalBus } from "@/bus/global"

const defaultProfileID = "default"

const Visibility = Schema.Literals(["show", "hide"])
export type Visibility = Schema.Schema.Type<typeof Visibility>

const AppSettingsFields = {
  general: Schema.Struct({
    autoSave: Schema.Boolean,
    releaseNotes: Schema.Boolean,
    followup: Schema.Literals(["queue", "steer"]),
    showFileTree: Schema.Boolean,
    showNavigation: Schema.Boolean,
    showSearch: Schema.Boolean,
    showStatus: Schema.Boolean,
    showTerminal: Schema.Boolean,
    showReasoningSummaries: Schema.Boolean,
    shellToolPartsExpanded: Schema.Boolean,
    editToolPartsExpanded: Schema.Boolean,
    showSessionProgressBar: Schema.Boolean,
    showCustomAgents: Schema.Boolean,
    newLayoutDesigns: Schema.Boolean,
  }),
  updates: Schema.Struct({
    startup: Schema.Boolean,
  }),
  appearance: Schema.Struct({
    fontSize: NonNegativeInt,
    mono: Schema.String,
    sans: Schema.String,
    terminal: Schema.String,
  }),
  permissions: Schema.Struct({
    autoApprove: Schema.Boolean,
  }),
  notifications: Schema.Struct({
    agent: Schema.Boolean,
    permissions: Schema.Boolean,
    errors: Schema.Boolean,
  }),
  sounds: Schema.Struct({
    agentEnabled: Schema.Boolean,
    agent: Schema.String,
    permissionsEnabled: Schema.Boolean,
    permissions: Schema.String,
    errorsEnabled: Schema.Boolean,
    errors: Schema.String,
  }),
}

export const AppSettings = Schema.Struct(AppSettingsFields).annotate({ identifier: "UiSettingsAppSettings" })
export type AppSettings = Schema.Schema.Type<typeof AppSettings>

export const Settings = Schema.Struct({
  ...AppSettingsFields,
  keybinds: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "UiSettingsSettings" })
export type Settings = Schema.Schema.Type<typeof Settings>

export const ModelKey = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
}).annotate({ identifier: "UiSettingsModelKey" })
export type ModelKey = Schema.Schema.Type<typeof ModelKey>

export const ModelPreference = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  visibility: Visibility,
  favorite: optionalOmitUndefined(Schema.Boolean),
}).annotate({ identifier: "UiSettingsModelPreference" })
export type ModelPreference = Schema.Schema.Type<typeof ModelPreference>

export const ModelSettings = Schema.Struct({
  user: Schema.Array(ModelPreference),
  recent: Schema.Array(ModelKey),
  variant: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Undefined])),
}).annotate({ identifier: "UiSettingsModelSettings" })
export type ModelSettings = Schema.Schema.Type<typeof ModelSettings>

export const Info = Schema.Struct({
  settings: Settings,
  model: ModelSettings,
}).annotate({ identifier: "UiSettings" })
export type Info = Schema.Schema.Type<typeof Info>

export const KeybindsInput = Schema.Struct({
  keybinds: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "UiSettingsKeybindsInput" })
export type KeybindsInput = Schema.Schema.Type<typeof KeybindsInput>

export const ModelPreferenceInput = Schema.Struct({
  visibility: optionalOmitUndefined(Visibility),
  favorite: optionalOmitUndefined(Schema.Boolean),
}).annotate({ identifier: "UiSettingsModelPreferenceInput" })
export type ModelPreferenceInput = Schema.Schema.Type<typeof ModelPreferenceInput>

export const RecentModelsInput = Schema.Struct({
  models: Schema.Array(ModelKey),
}).annotate({ identifier: "UiSettingsRecentModelsInput" })
export type RecentModelsInput = Schema.Schema.Type<typeof RecentModelsInput>

export const ModelVariantInput = Schema.Struct({
  variant: optionalOmitUndefined(Schema.String),
}).annotate({ identifier: "UiSettingsModelVariantInput" })
export type ModelVariantInput = Schema.Schema.Type<typeof ModelVariantInput>

export const defaultAppSettings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "steer",
    showFileTree: false,
    showNavigation: false,
    showSearch: false,
    showStatus: false,
    showTerminal: false,
    showReasoningSummaries: false,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    showSessionProgressBar: true,
    showCustomAgents: false,
    newLayoutDesigns: true,
  },
  updates: {
    startup: true,
  },
  appearance: {
    fontSize: 14,
    mono: "",
    sans: "",
    terminal: "",
  },
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
} satisfies AppSettings

export const defaultSettings = { ...defaultAppSettings, keybinds: {} } satisfies Settings

export const Event = {
  Updated: EventV2.define({
    type: "ui.settings.updated",
    schema: { profileID: Schema.String },
  }),
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly updateApp: (input: AppSettings) => Effect.Effect<Info>
  readonly replaceKeybinds: (input: KeybindsInput) => Effect.Effect<Info>
  readonly updateModelPreference: (
    providerID: string,
    modelID: string,
    input: ModelPreferenceInput,
  ) => Effect.Effect<Info>
  readonly replaceRecentModels: (input: RecentModelsInput) => Effect.Effect<Info>
  readonly updateModelVariant: (providerID: string, modelID: string, input: ModelVariantInput) => Effect.Effect<Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UiSettings") {}

type Db = Database.Interface["db"]
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0]
type DatabaseLike = Db | Transaction

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const emitUpdated = () =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            id: EventV2.ID.create(),
            type: Event.Updated.type,
            properties: { profileID: defaultProfileID },
          },
        }),
      )

    const ensureProfile = (d: DatabaseLike) =>
      d
        .insert(UiSettingsProfileTable)
        .values({ id: defaultProfileID, name: "Default", time_created: Date.now(), time_updated: Date.now() })
        .onConflictDoNothing()
        .run()

    const appRow = (input: AppSettings, time_created: number, time_updated: number) => ({
      profile_id: defaultProfileID,
      general_auto_save: input.general.autoSave,
      general_release_notes: input.general.releaseNotes,
      general_followup: input.general.followup,
      general_show_file_tree: input.general.showFileTree,
      general_show_navigation: input.general.showNavigation,
      general_show_search: input.general.showSearch,
      general_show_status: input.general.showStatus,
      general_show_terminal: input.general.showTerminal,
      general_show_reasoning_summaries: input.general.showReasoningSummaries,
      general_shell_tool_parts_expanded: input.general.shellToolPartsExpanded,
      general_edit_tool_parts_expanded: input.general.editToolPartsExpanded,
      general_show_session_progress_bar: input.general.showSessionProgressBar,
      general_show_custom_agents: input.general.showCustomAgents,
      general_new_layout_designs: input.general.newLayoutDesigns,
      updates_startup: input.updates.startup,
      appearance_font_size: input.appearance.fontSize,
      appearance_mono: input.appearance.mono,
      appearance_sans: input.appearance.sans,
      appearance_terminal: input.appearance.terminal,
      permissions_auto_approve: input.permissions.autoApprove,
      notifications_agent: input.notifications.agent,
      notifications_permissions: input.notifications.permissions,
      notifications_errors: input.notifications.errors,
      sounds_agent_enabled: input.sounds.agentEnabled,
      sounds_agent: input.sounds.agent,
      sounds_permissions_enabled: input.sounds.permissionsEnabled,
      sounds_permissions: input.sounds.permissions,
      sounds_errors_enabled: input.sounds.errorsEnabled,
      sounds_errors: input.sounds.errors,
      time_created,
      time_updated,
    })

    const appSettingsFromRow = (row: typeof UiAppSettingsTable.$inferSelect | undefined): AppSettings => {
      if (!row) return defaultAppSettings
      return {
        general: {
          autoSave: row.general_auto_save,
          releaseNotes: row.general_release_notes,
          followup: parseFollowup(row.general_followup),
          showFileTree: row.general_show_file_tree,
          showNavigation: row.general_show_navigation,
          showSearch: row.general_show_search,
          showStatus: row.general_show_status,
          showTerminal: row.general_show_terminal,
          showReasoningSummaries: row.general_show_reasoning_summaries,
          shellToolPartsExpanded: row.general_shell_tool_parts_expanded,
          editToolPartsExpanded: row.general_edit_tool_parts_expanded,
          showSessionProgressBar: row.general_show_session_progress_bar,
          showCustomAgents: row.general_show_custom_agents,
          newLayoutDesigns: row.general_new_layout_designs,
        },
        updates: { startup: row.updates_startup },
        appearance: {
          fontSize: row.appearance_font_size,
          mono: row.appearance_mono,
          sans: row.appearance_sans,
          terminal: row.appearance_terminal,
        },
        permissions: { autoApprove: row.permissions_auto_approve },
        notifications: {
          agent: row.notifications_agent,
          permissions: row.notifications_permissions,
          errors: row.notifications_errors,
        },
        sounds: {
          agentEnabled: row.sounds_agent_enabled,
          agent: row.sounds_agent,
          permissionsEnabled: row.sounds_permissions_enabled,
          permissions: row.sounds_permissions,
          errorsEnabled: row.sounds_errors_enabled,
          errors: row.sounds_errors,
        },
      }
    }

    const read = Effect.fn("UiSettings.read")(function* (d: DatabaseLike) {
      yield* ensureProfile(d).pipe(Effect.orDie)
      const app = yield* d
        .select()
        .from(UiAppSettingsTable)
        .where(eq(UiAppSettingsTable.profile_id, defaultProfileID))
        .get()
        .pipe(Effect.orDie)
      const keybindRows = yield* d
        .select()
        .from(UiKeybindTable)
        .where(eq(UiKeybindTable.profile_id, defaultProfileID))
        .all()
        .pipe(Effect.orDie)
      const user = yield* d
        .select()
        .from(UiModelPreferenceTable)
        .where(eq(UiModelPreferenceTable.profile_id, defaultProfileID))
        .all()
        .pipe(Effect.orDie)
      const recent = yield* d
        .select()
        .from(UiModelRecentTable)
        .where(eq(UiModelRecentTable.profile_id, defaultProfileID))
        .orderBy(asc(UiModelRecentTable.position))
        .all()
        .pipe(Effect.orDie)
      const variants = yield* d
        .select()
        .from(UiModelVariantTable)
        .where(eq(UiModelVariantTable.profile_id, defaultProfileID))
        .all()
        .pipe(Effect.orDie)
      return {
        settings: {
          ...appSettingsFromRow(app),
          keybinds: Object.fromEntries(keybindRows.map((row) => [row.action, row.keybind])),
        },
        model: {
          user: user.map((row) => ({
            providerID: row.provider_id,
            modelID: row.model_id,
            visibility: row.visibility === "hide" ? "hide" : "show",
            ...(row.favorite === null ? {} : { favorite: row.favorite }),
          })),
          recent: recent.map((row) => ({ providerID: row.provider_id, modelID: row.model_id })),
          variant: Object.fromEntries(variants.map((row) => [`${row.provider_id}/${row.model_id}`, row.variant])),
        },
      } satisfies Info
    })

    const updateApp = Effect.fn("UiSettings.updateApp")(function* (input: AppSettings) {
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* ensureProfile(tx).pipe(Effect.orDie)
            const current = yield* tx
              .select()
              .from(UiAppSettingsTable)
              .where(eq(UiAppSettingsTable.profile_id, defaultProfileID))
              .get()
              .pipe(Effect.orDie)
            const now = Date.now()
            const row = appRow(input, current?.time_created ?? now, now)
            yield* tx
              .insert(UiAppSettingsTable)
              .values(row)
              .onConflictDoUpdate({ target: UiAppSettingsTable.profile_id, set: row })
              .run()
              .pipe(Effect.orDie)
            return yield* read(tx)
          }),
        )
        .pipe(Effect.orDie)
      yield* emitUpdated()
      return result
    })

    const replaceKeybinds = Effect.fn("UiSettings.replaceKeybinds")(function* (input: KeybindsInput) {
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* ensureProfile(tx).pipe(Effect.orDie)
            yield* tx.delete(UiKeybindTable).where(eq(UiKeybindTable.profile_id, defaultProfileID)).run().pipe(Effect.orDie)
            const rows = Object.entries(input.keybinds).map(([action, keybind]) => ({
              profile_id: defaultProfileID,
              action,
              keybind,
              time_created: Date.now(),
              time_updated: Date.now(),
            }))
            if (rows.length > 0) yield* tx.insert(UiKeybindTable).values(rows).run().pipe(Effect.orDie)
            return yield* read(tx)
          }),
        )
        .pipe(Effect.orDie)
      yield* emitUpdated()
      return result
    })

    const updateModelPreference = Effect.fn("UiSettings.updateModelPreference")(function* (
      providerID: string,
      modelID: string,
      input: ModelPreferenceInput,
    ) {
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* ensureProfile(tx).pipe(Effect.orDie)
            const current = yield* tx
              .select()
              .from(UiModelPreferenceTable)
              .where(eq(UiModelPreferenceTable.profile_id, defaultProfileID))
              .all()
              .pipe(Effect.orDie)
            const row = current.find((item) => item.provider_id === providerID && item.model_id === modelID)
            const now = Date.now()
            const next = {
              profile_id: defaultProfileID,
              provider_id: providerID,
              model_id: modelID,
              visibility: input.visibility ?? row?.visibility ?? "show",
              favorite: input.favorite ?? row?.favorite ?? null,
              time_created: row?.time_created ?? now,
              time_updated: now,
            }
            yield* tx
              .insert(UiModelPreferenceTable)
              .values(next)
              .onConflictDoUpdate({
                target: [
                  UiModelPreferenceTable.profile_id,
                  UiModelPreferenceTable.provider_id,
                  UiModelPreferenceTable.model_id,
                ],
                set: next,
              })
              .run()
              .pipe(Effect.orDie)
            return yield* read(tx)
          }),
        )
        .pipe(Effect.orDie)
      yield* emitUpdated()
      return result
    })

    const replaceRecentModels = Effect.fn("UiSettings.replaceRecentModels")(function* (input: RecentModelsInput) {
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* ensureProfile(tx).pipe(Effect.orDie)
            yield* tx
              .delete(UiModelRecentTable)
              .where(eq(UiModelRecentTable.profile_id, defaultProfileID))
              .run()
              .pipe(Effect.orDie)
            const models = input.models.filter(
              (model, index) =>
                input.models.findIndex((item) => item.providerID === model.providerID && item.modelID === model.modelID) ===
                index,
            )
            const rows = models.map((model, position) => ({
              profile_id: defaultProfileID,
              provider_id: model.providerID,
              model_id: model.modelID,
              position,
              time_created: Date.now(),
              time_updated: Date.now(),
            }))
            if (rows.length > 0) yield* tx.insert(UiModelRecentTable).values(rows).run().pipe(Effect.orDie)
            return yield* read(tx)
          }),
        )
        .pipe(Effect.orDie)
      yield* emitUpdated()
      return result
    })

    const updateModelVariant = Effect.fn("UiSettings.updateModelVariant")(function* (
      providerID: string,
      modelID: string,
      input: ModelVariantInput,
    ) {
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* ensureProfile(tx).pipe(Effect.orDie)
            if (input.variant === undefined) {
              const rows = yield* tx
                .select()
                .from(UiModelVariantTable)
                .where(eq(UiModelVariantTable.profile_id, defaultProfileID))
                .all()
                .pipe(Effect.orDie)
              const keep = rows.filter((row) => row.provider_id !== providerID || row.model_id !== modelID)
              yield* tx
                .delete(UiModelVariantTable)
                .where(eq(UiModelVariantTable.profile_id, defaultProfileID))
                .run()
                .pipe(Effect.orDie)
              if (keep.length > 0) yield* tx.insert(UiModelVariantTable).values(keep).run().pipe(Effect.orDie)
              return yield* read(tx)
            }
            const current = yield* tx
              .select()
              .from(UiModelVariantTable)
              .where(eq(UiModelVariantTable.profile_id, defaultProfileID))
              .all()
              .pipe(Effect.orDie)
            const row = current.find((item) => item.provider_id === providerID && item.model_id === modelID)
            const now = Date.now()
            const next = {
              profile_id: defaultProfileID,
              provider_id: providerID,
              model_id: modelID,
              variant: input.variant,
              time_created: row?.time_created ?? now,
              time_updated: now,
            }
            yield* tx
              .insert(UiModelVariantTable)
              .values(next)
              .onConflictDoUpdate({
                target: [UiModelVariantTable.profile_id, UiModelVariantTable.provider_id, UiModelVariantTable.model_id],
                set: next,
              })
              .run()
              .pipe(Effect.orDie)
            return yield* read(tx)
          }),
        )
        .pipe(Effect.orDie)
      yield* emitUpdated()
      return result
    })

    const get = Effect.fn("UiSettings.get")(function* () {
      return yield* read(db)
    })

    return Service.of({
      get,
      updateApp,
      replaceKeybinds,
      updateModelPreference,
      replaceRecentModels,
      updateModelVariant,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

function parseFollowup(value: string) {
  if (value === "queue" || value === "steer") return value
  return defaultAppSettings.general.followup
}

export const UiSettings = {
  AppSettings,
  Settings,
  ModelKey,
  ModelPreference,
  ModelSettings,
  Info,
  KeybindsInput,
  ModelPreferenceInput,
  RecentModelsInput,
  ModelVariantInput,
  defaultAppSettings,
  defaultSettings,
  Event,
  Service,
  layer,
  defaultLayer,
}
