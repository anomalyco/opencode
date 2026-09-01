import { reconcile } from "solid-js/store"
import { createEffect, createMemo } from "solid-js"
import { Effect, Option, Schema, SchemaGetter } from "effect"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { ReasoningMode } from "@opencode-ai/session-ui/timeline/projection"
import { persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { ScopedKey, type ServerScope } from "@/runtime/server/scope"

export type Settings = typeof settingsSchema.Type
export type WorkspaceDefaultDestination = Settings["workspaces"]["defaultDestination"]
export type WorkspaceLastUsed = Settings["workspaces"]["lastUsed"][string]
export type TerminalPlacement = Settings["general"]["terminalPlacement"]
export type FollowUpBehavior = Settings["general"]["followUpBehavior"]
export type TabLayout = Settings["appearance"]["tabLayout"]
export type NotificationSettings = Settings["notifications"]
export type SoundSettings = Settings["sounds"]

export const monoDefault = "IBM Plex Mono"
export const sansDefault = "Inter"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"
const monoFallback =
  '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback = '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback
const sansBase = sansFallback
const terminalBase = terminalFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

const reasoningModeSchema = Schema.Literals(["hidden", "compact", "full"])

const generalSchema = Persistence.struct({
  autoSave: Persistence.fallback(Schema.Boolean, () => true),
  releaseNotes: Persistence.fallback(Schema.Boolean, () => true),
  showFileTree: Persistence.fallback(Schema.Boolean, () => false),
  showNavigation: Persistence.fallback(Schema.Boolean, () => false),
  showSearch: Persistence.fallback(Schema.Boolean, () => false),
  showStatus: Persistence.fallback(Schema.Boolean, () => false),
  showProjectIcon: Persistence.fallback(Schema.Boolean, () => false),
  showTerminal: Persistence.fallback(Schema.Boolean, () => false),
  reasoningMode: Persistence.fallback(reasoningModeSchema, () => "compact" as const),
  shellToolPartsExpanded: Persistence.fallback(Schema.Boolean, () => false),
  editToolPartsExpanded: Persistence.fallback(Schema.Boolean, () => false),
  showCustomAgents: Persistence.fallback(Schema.Boolean, () => false),
  mobileTitlebarPosition: Persistence.fallback(Schema.Literals(["top", "bottom"]), () => "top" as const),
  mobileDiffWrap: Persistence.fallback(Schema.Boolean, () => true),
  terminalPlacement: Persistence.fallback(Schema.Literals(["side", "bottom"]), () => "side" as const),
  followUpBehavior: Persistence.fallback(Schema.Literals(["queue", "steer"]), () => "steer" as const),
})

const persistedGeneralSchema = Schema.Struct({
  ...generalSchema.fields,
  reasoningMode: Schema.optional(reasoningModeSchema).pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some("compact" as const))),
  ),
  showReasoningSummaries: Persistence.optional(Schema.Boolean),
}).pipe(
  Schema.decodeTo(Schema.toType(generalSchema), {
    decode: SchemaGetter.transform((value) => ({
      ...value,
      reasoningMode: value.reasoningMode ?? (value.showReasoningSummaries === true ? "full" : "compact"),
    })),
    encode: SchemaGetter.transform((value) => value),
  }),
)

const appearanceSchema = Persistence.struct({
  fontSize: Persistence.fallback(Schema.Number, () => 14),
  mono: Persistence.fallback(Schema.String, () => ""),
  sans: Persistence.fallback(Schema.String, () => ""),
  terminal: Persistence.fallback(Schema.String, () => ""),
  tabLayout: Persistence.fallback(Schema.Literals(["horizontal", "vertical"]), () => "horizontal" as const),
})

const permissionsSchema = Persistence.struct({
  autoApprove: Persistence.fallback(Schema.Boolean, () => false),
})

const workspacesSchema = Persistence.struct({
  defaultDestination: Persistence.fallback(Schema.Literals(["last-used", "local", "new"]), () => "last-used" as const),
  lastUsed: Persistence.record(
    Schema.Literals(["local", "workspace"]).pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))),
  ),
})

const notificationsSchema = Persistence.struct({
  agent: Persistence.fallback(Schema.Boolean, () => true),
  permissions: Persistence.fallback(Schema.Boolean, () => true),
  errors: Persistence.fallback(Schema.Boolean, () => false),
})

const soundsSchema = Persistence.struct({
  agentEnabled: Persistence.fallback(Schema.Boolean, () => true),
  agent: Persistence.fallback(Schema.String, () => "staplebops-01"),
  permissionsEnabled: Persistence.fallback(Schema.Boolean, () => true),
  permissions: Persistence.fallback(Schema.String, () => "staplebops-02"),
  errorsEnabled: Persistence.fallback(Schema.Boolean, () => true),
  errors: Persistence.fallback(Schema.String, () => "nope-03"),
})

export const settingsSchema = Persistence.struct({
  general: Persistence.fallback(persistedGeneralSchema, () => Schema.decodeUnknownSync(generalSchema)({})),
  appearance: Persistence.fallback(appearanceSchema, () => Schema.decodeUnknownSync(appearanceSchema)({})),
  keybinds: Persistence.record(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))),
  permissions: Persistence.fallback(permissionsSchema, () => Schema.decodeUnknownSync(permissionsSchema)({})),
  workspaces: Persistence.fallback(workspacesSchema, () => Schema.decodeUnknownSync(workspacesSchema)({})),
  notifications: Persistence.fallback(notificationsSchema, () => Schema.decodeUnknownSync(notificationsSchema)({})),
  sounds: Persistence.fallback(soundsSchema, () => Schema.decodeUnknownSync(soundsSchema)({})),
})

const defaultSettings = Schema.decodeUnknownSync(settingsSchema)({})

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  gate: false,
  init: () => {
    const [store, setStore, , ready] = persisted({ key: "settings.v3" }, settingsSchema)
    const showFileTree = withFallback(() => store.general?.showFileTree, defaultSettings.general.showFileTree)
    const showSearch = withFallback(() => store.general?.showSearch, defaultSettings.general.showSearch)
    const showStatus = withFallback(() => store.general?.showStatus, defaultSettings.general.showStatus)
    const showCustomAgents = withFallback(
      () => store.general?.showCustomAgents,
      defaultSettings.general.showCustomAgents,
    )
    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
    })

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        releaseNotes: withFallback(() => store.general?.releaseNotes, defaultSettings.general.releaseNotes),
        setReleaseNotes(value: boolean) {
          setStore("general", "releaseNotes", value)
        },
        showFileTree,
        setShowFileTree(value: boolean) {
          setStore("general", "showFileTree", value)
        },
        showNavigation: withFallback(() => store.general?.showNavigation, defaultSettings.general.showNavigation),
        setShowNavigation(value: boolean) {
          setStore("general", "showNavigation", value)
        },
        showSearch,
        setShowSearch(value: boolean) {
          setStore("general", "showSearch", value)
        },
        showStatus,
        setShowStatus(value: boolean) {
          setStore("general", "showStatus", value)
        },
        showProjectIcon: withFallback(() => store.general?.showProjectIcon, defaultSettings.general.showProjectIcon),
        setShowProjectIcon(value: boolean) {
          setStore("general", "showProjectIcon", value)
        },
        showTerminal: withFallback(() => store.general?.showTerminal, defaultSettings.general.showTerminal),
        setShowTerminal(value: boolean) {
          setStore("general", "showTerminal", value)
        },
        reasoningMode: withFallback(() => store.general?.reasoningMode, defaultSettings.general.reasoningMode),
        setReasoningMode(value: ReasoningMode) {
          setStore("general", "reasoningMode", value)
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
        showCustomAgents,
        setShowCustomAgents(value: boolean) {
          setStore("general", "showCustomAgents", value)
        },
        mobileTitlebarPosition: withFallback(
          () => store.general?.mobileTitlebarPosition,
          defaultSettings.general.mobileTitlebarPosition,
        ),
        setMobileTitlebarPosition(value: "top" | "bottom") {
          setStore("general", "mobileTitlebarPosition", value)
        },
        mobileDiffWrap: withFallback(() => store.general?.mobileDiffWrap, defaultSettings.general.mobileDiffWrap),
        setMobileDiffWrap(value: boolean) {
          setStore("general", "mobileDiffWrap", value)
        },
        terminalPlacement: withFallback(
          () => store.general?.terminalPlacement,
          defaultSettings.general.terminalPlacement,
        ),
        setTerminalPlacement(value: TerminalPlacement) {
          setStore("general", "terminalPlacement", value)
        },
        followUpBehavior: withFallback(() => store.general?.followUpBehavior, defaultSettings.general.followUpBehavior),
        setFollowUpBehavior(value: FollowUpBehavior) {
          setStore("general", "followUpBehavior", value)
        },
      },
      visibility: {
        fileTree: showFileTree,
        search: showSearch,
        status: showStatus,
        customAgents: showCustomAgents,
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
        },
        terminalFont: withFallback(() => store.appearance?.terminal, defaultSettings.appearance.terminal),
        setTerminalFont(value: string) {
          setStore("appearance", "terminal", value.trim() ? value : "")
        },
        tabLayout: withFallback(() => store.appearance?.tabLayout, defaultSettings.appearance.tabLayout),
        setTabLayout(value: TabLayout) {
          setStore("appearance", "tabLayout", value)
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.prototype.hasOwnProperty.call(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      permissions: {
        autoApprove: withFallback(() => store.permissions?.autoApprove, defaultSettings.permissions.autoApprove),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
      },
      workspaces: {
        defaultDestination: withFallback(
          () => store.workspaces?.defaultDestination,
          defaultSettings.workspaces.defaultDestination,
        ),
        setDefaultDestination(value: WorkspaceDefaultDestination) {
          setStore("workspaces", (current) => ({
            ...defaultSettings.workspaces,
            ...current,
            defaultDestination: value,
          }))
        },
        lastUsed(scope: ServerScope, projectID: string) {
          return store.workspaces?.lastUsed?.[ScopedKey.from(scope, projectID)]
        },
        setLastUsed(scope: ServerScope, projectID: string, value: WorkspaceLastUsed) {
          setStore("workspaces", (current) => ({
            ...defaultSettings.workspaces,
            ...current,
            lastUsed: { ...current?.lastUsed, [ScopedKey.from(scope, projectID)]: value },
          }))
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
      },
      sounds: {
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
    }
  },
})
