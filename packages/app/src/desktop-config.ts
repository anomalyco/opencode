import { Option, Schema } from "effect"

const FollowupSchema = Schema.Union([Schema.Literal("queue"), Schema.Literal("steer")])

const GeneralSchema = Schema.Struct({
  autoSave: Schema.optional(Schema.Boolean),
  releaseNotes: Schema.optional(Schema.Boolean),
  followup: Schema.optional(FollowupSchema),
  showFileTree: Schema.optional(Schema.Boolean),
  showNavigation: Schema.optional(Schema.Boolean),
  showSearch: Schema.optional(Schema.Boolean),
  showStatus: Schema.optional(Schema.Boolean),
  showTerminal: Schema.optional(Schema.Boolean),
  showReasoningSummaries: Schema.optional(Schema.Boolean),
  shellToolPartsExpanded: Schema.optional(Schema.Boolean),
  editToolPartsExpanded: Schema.optional(Schema.Boolean),
  showSessionProgressBar: Schema.optional(Schema.Boolean),
  showCustomAgents: Schema.optional(Schema.Boolean),
  newLayoutDesigns: Schema.optional(Schema.Boolean),
})

const PermissionsSchema = Schema.Struct({
  autoApprove: Schema.optional(Schema.Boolean),
})

const SoundsSchema = Schema.Struct({
  agentEnabled: Schema.optional(Schema.Boolean),
  agent: Schema.optional(Schema.String),
  permissionsEnabled: Schema.optional(Schema.Boolean),
  permissions: Schema.optional(Schema.String),
  errorsEnabled: Schema.optional(Schema.Boolean),
  errors: Schema.optional(Schema.String),
})

export const DesktopConfigSchema = Schema.Struct({
  general: Schema.optional(GeneralSchema),
  permissions: Schema.optional(PermissionsSchema),
  sounds: Schema.optional(SoundsSchema),
})

export type DesktopConfig = typeof DesktopConfigSchema.Type

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean)
const decodeString = Schema.decodeUnknownOption(Schema.String)
const decodeFollowup = Schema.decodeUnknownOption(FollowupSchema)

export function decodeDesktopConfigJson(value: string) {
  const parsed = Option.getOrUndefined(decodeJson(value))
  if (parsed === undefined) return
  return decodeDesktopConfig(parsed)
}

export function decodeDesktopConfig(value: unknown): DesktopConfig | undefined {
  const data = Option.getOrUndefined(decodeRecord(value))
  if (!data) return

  const general = Option.getOrUndefined(decodeRecord(data.general))
  const permissions = Option.getOrUndefined(decodeRecord(data.permissions))
  const sounds = Option.getOrUndefined(decodeRecord(data.sounds))

  return stripUndefined({
    general: general
      ? stripUndefined({
          autoSave: Option.getOrUndefined(decodeBoolean(general.autoSave)),
          releaseNotes: Option.getOrUndefined(decodeBoolean(general.releaseNotes)),
          followup: Option.getOrUndefined(decodeFollowup(general.followup)),
          showFileTree: Option.getOrUndefined(decodeBoolean(general.showFileTree)),
          showNavigation: Option.getOrUndefined(decodeBoolean(general.showNavigation)),
          showSearch: Option.getOrUndefined(decodeBoolean(general.showSearch)),
          showStatus: Option.getOrUndefined(decodeBoolean(general.showStatus)),
          showTerminal: Option.getOrUndefined(decodeBoolean(general.showTerminal)),
          showReasoningSummaries: Option.getOrUndefined(decodeBoolean(general.showReasoningSummaries)),
          shellToolPartsExpanded: Option.getOrUndefined(decodeBoolean(general.shellToolPartsExpanded)),
          editToolPartsExpanded: Option.getOrUndefined(decodeBoolean(general.editToolPartsExpanded)),
          showSessionProgressBar: Option.getOrUndefined(decodeBoolean(general.showSessionProgressBar)),
          showCustomAgents: Option.getOrUndefined(decodeBoolean(general.showCustomAgents)),
          newLayoutDesigns: Option.getOrUndefined(decodeBoolean(general.newLayoutDesigns)),
        })
      : undefined,
    permissions: permissions
      ? stripUndefined({
          autoApprove: Option.getOrUndefined(decodeBoolean(permissions.autoApprove)),
        })
      : undefined,
    sounds: sounds
      ? stripUndefined({
          agentEnabled: Option.getOrUndefined(decodeBoolean(sounds.agentEnabled)),
          agent: Option.getOrUndefined(decodeString(sounds.agent)),
          permissionsEnabled: Option.getOrUndefined(decodeBoolean(sounds.permissionsEnabled)),
          permissions: Option.getOrUndefined(decodeString(sounds.permissions)),
          errorsEnabled: Option.getOrUndefined(decodeBoolean(sounds.errorsEnabled)),
          errors: Option.getOrUndefined(decodeString(sounds.errors)),
        })
      : undefined,
  })
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T as undefined extends T[K] ? K : K]: Exclude<T[K], undefined>
  }
}
