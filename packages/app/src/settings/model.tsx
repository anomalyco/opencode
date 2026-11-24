import { produce, reconcile, unwrap } from "solid-js/store"
import { createEffect, createMemo } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Effect, Option, Predicate, Schema, SchemaGetter } from "effect"
import { createSimpleContext } from "@opencode/ui/context"
import { timelinePresets, type TimelineCategory, type TimelineDetail } from "@opencode/session-ui/timeline/detail"
import { persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { usePlatform } from "@/runtime/platform/platform"
import { ScopedKey, type ServerScope } from "@/runtime/server/scope"

export type Settings = typeof settingsSchema.Type

export type WorkspaceDefaultDestination = Settings["workspaces"]["defaultDestination"]

export type WorkspaceLastUsed = Settings["workspaces"]["lastUsed"][string]

export type FollowUpBehavior = Settings["general"]["followUpBehavior"]

export type QuestionSubmitKey = Settings["general"]["questionSubmitKey"]

export type BackgroundActivity = Settings["general"]["backgroundActivity"]

export type TimelineWidth = Settings["general"]["timelineWidth"]

export type SidebarOrganize = Exclude<Settings["general"]["sidebarOrganize"], "projects">

export type TabLayout = Settings["appearance"]["tabLayout"]

export type ReduceMotion = Settings["appearance"]["reduceMotion"]

export type NotificationSettings = Settings["notifications"]

export type SoundSettings = Settings["sounds"]

// Names a project for per-project settings: project IDs are only unique within one server.
export function projectSettingsKey(scope: ServerScope, projectID: string | undefined) {
  return projectID ? ScopedKey.from(scope, projectID) : undefined
}

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

const placementSchema = Schema.Literals(["separate", "grouped", "hidden"])

const detailsSchema = Schema.Literals(["collapsed", "expanded"])

const activitySchema = Persistence.struct({ placement: placementSchema, details: detailsSchema })

const placementOnlySchema = Persistence.struct({ placement: placementSchema })

const generalSchema = Persistence.struct({
  // Retired preferences without readers; kept so stored values still decode and round-trip.
  autoSave: Persistence.optional(Schema.Boolean),
  showFileTree: Persistence.optional(Schema.Boolean),
  showTurnNavigator: Persistence.optional(Schema.Boolean),
  // Owned by the updater plugin, which copies it out once; kept so settings rewrites cannot drop it first.
  releaseNotes: Persistence.optional(Schema.Boolean),
  showNavigation: Persistence.optional(Schema.Boolean),
  showSearch: Persistence.optional(Schema.Boolean),
  showTerminal: Persistence.optional(Schema.Boolean),
  timelineDetail: Persistence.struct({
    shell: activitySchema,
    edit: activitySchema,
    thinking: activitySchema,
    subagents: placementOnlySchema,
    notices: placementOnlySchema,
    tools: placementOnlySchema,
    commentary: placementOnlySchema,
  }),
  showCustomAgents: Schema.Boolean,
  showTurnDiffs: Schema.Boolean,
  backgroundActivity: Schema.Literals(["off", "left", "center", "right"]),
  timelineWidth: Schema.Literals(["focused", "comfortable", "wide"]),
  foldUserMessages: Schema.Boolean,
  wrapCodeBlocks: Schema.Boolean,
  // The redesigned keyboard-first question dock, off until it ships.
  newQuestionUI: Schema.Boolean,
  // The redesigned session timeline, off until it ships.
  newTimeline: Persistence.optional(Schema.Boolean),
  // Browser-style session tab grouping across vertical and horizontal tabs.
  tabGroups: Persistence.optional(Schema.Boolean),
  // One side panel open state for every session tab, instead of one per tab.
  sharedSidePanel: Persistence.optional(Schema.Boolean),
  // "projects" is retired; `resolveSidebarOrganize` moves it to its replacement.
  sidebarOrganize: Schema.Literals(["projects", "list", "customize", "recent", "consolidated"]),
  mobileTitlebarPosition: Schema.Literals(["top", "bottom"]),
  // Owned by the review plugin, which copies it out once; kept so settings rewrites cannot drop it first.
  mobileDiffWrap: Persistence.optional(Schema.Boolean),
  followUpBehavior: Schema.Literals(["queue", "steer"]),
  // The key that moves a question dock on, or submits it on the last question. The other Enter selects an answer or
  // starts a new line in the custom answer.
  questionSubmitKey: Schema.Literals(["enter", "mod+enter"]),
})

const appearanceSchema = Persistence.struct({
  fontSize: Schema.Number,
  mono: Schema.String,
  sans: Schema.String,
  terminal: Schema.String,
  // "inbox" is experimental: the vertical layout with a server-wide session inbox in place of tabs.
  tabLayout: Schema.Literals(["horizontal", "vertical", "inbox"]),
  // Prototype (local/dev desktop builds): tabs at `tabLayout`'s position, or one list of every session.
  navigation: Persistence.optional(Schema.Literals(["tabs", "list"])),
  sidebarOpen: Persistence.optional(Schema.Boolean),
  reduceMotion: Schema.Literals(["system", "on", "off"]),
})

const permissionsSchema = Persistence.struct({
  // The default for every project.
  autoApprove: Schema.Boolean,
  // Projects that override the default, keyed by server scope and project ID. Absent projects use the default.
  autoApproveProjects: Persistence.record(
    Schema.Boolean.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))),
  ),
})

const workspacesSchema = Persistence.struct({
  defaultDestination: Schema.Literals(["last-used", "local", "new"]),
  lastUsed: Persistence.record(
    Schema.Literals(["local", "workspace"]).pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))),
  ),
})

const notificationsSchema = Persistence.struct({
  agent: Schema.Boolean,
  permissions: Schema.Boolean,
  questions: Schema.Boolean,
  errors: Schema.Boolean,
})

const soundsSchema = Persistence.struct({
  agentEnabled: Schema.Boolean,
  agent: Schema.String,
  permissionsEnabled: Schema.Boolean,
  permissions: Schema.String,
  questionsEnabled: Schema.Boolean,
  questions: Schema.String,
  errorsEnabled: Schema.Boolean,
  errors: Schema.String,
  interfaceEnabled: Schema.optional(Schema.Boolean),
})

export const settingsSchema = Persistence.struct({
  general: generalSchema,
  // Owned by the details plugin, which copies it out once; kept so settings rewrites cannot drop it first.
  sessionSummary: Schema.optional(
    Persistence.struct({ projectExpanded: Schema.Boolean, serverExpanded: Schema.Boolean }),
  ),
  appearance: appearanceSchema,
  keybinds: Persistence.record(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))),
  permissions: permissionsSchema,
  workspaces: workspacesSchema,
  notifications: notificationsSchema,
  sounds: soundsSchema,
})

function storedTimelineCategory(category: TimelineCategory) {
  return Persistence.optional(
    Schema.Union([
      Persistence.legacy({
        placement: Persistence.optional(placementSchema),
        details: Persistence.optional(detailsSchema),
      }),
      Schema.Literals(["expanded", "collapsed", "hidden", "visible"]),
    ]).pipe(
      Schema.decode({
        decode: SchemaGetter.transform((value) => {
          if (!Predicate.isString(value)) return value

          return {
            placement:
              value === "hidden"
                ? "hidden"
                : category === "subagents"
                  ? "separate"
                  : category === "tools"
                    ? "grouped"
                    : value === "expanded"
                      ? "separate"
                      : value === "collapsed"
                        ? "grouped"
                        : undefined,
            details: value === "expanded" ? "expanded" : "collapsed",
          }
        }),
        encode: SchemaGetter.passthrough(),
      }),
    ),
  )
}

function legacyTimelineActivity(value: boolean | "hidden" | "compact" | "full" | null | undefined) {
  if (value === undefined || value === null) return
  const expanded = value === true || value === "full"

  return {
    placement: value === "hidden" ? "hidden" : expanded ? "separate" : "grouped",
    details: expanded ? "expanded" : "collapsed",
  } as const
}

export const settingsPersistence = Persistence.migrate(
  settingsSchema,
  Persistence.legacy({
    general: Persistence.optional(
      Persistence.legacy({
        // Keep invalid explicit values distinct from absent values so legacy preferences cannot replace them.
        timelineDetail: Schema.optional(
          Schema.NullOr(
            Persistence.legacy({
              shell: storedTimelineCategory("shell"),
              edit: storedTimelineCategory("edit"),
              thinking: storedTimelineCategory("thinking"),
              subagents: storedTimelineCategory("subagents"),
              notices: storedTimelineCategory("notices"),
              tools: storedTimelineCategory("tools"),
            }),
          ),
        ).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(null)))),
        reasoningMode: Schema.optional(Schema.NullOr(Schema.Literals(["hidden", "compact", "full"]))).pipe(
          Schema.catchDecoding(() => Effect.succeed(Option.some(null))),
        ),
        showReasoningSummaries: Persistence.optional(Schema.Boolean),
        shellToolPartsExpanded: Persistence.optional(Schema.Boolean),
        editToolPartsExpanded: Persistence.optional(Schema.Boolean),
      }),
    ),
  }).pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => {
        const general = value.general

        if (!general || general.timelineDetail !== undefined) return value

        return {
          ...value,
          general: {
            ...general,
            timelineDetail: {
              shell: legacyTimelineActivity(general.shellToolPartsExpanded),
              edit: legacyTimelineActivity(general.editToolPartsExpanded),
              thinking: legacyTimelineActivity(
                general.reasoningMode === undefined ? general.showReasoningSummaries : general.reasoningMode,
              ),
            },
          },
        }
      }),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
)

export const defaultSettings: Settings = {
  general: {
    timelineDetail: { ...timelinePresets[2].value },
    showCustomAgents: true,
    showTurnDiffs: false,
    backgroundActivity: "left",
    timelineWidth: "comfortable",
    foldUserMessages: false,
    wrapCodeBlocks: false,
    newQuestionUI: false,
    sidebarOrganize: "list",
    mobileTitlebarPosition: "top",
    followUpBehavior: "steer",
    questionSubmitKey: "enter",
  },
  appearance: { fontSize: 14, mono: "", sans: "", terminal: "", tabLayout: "horizontal", reduceMotion: "system" },
  keybinds: {},
  permissions: { autoApprove: false, autoApproveProjects: {} },
  workspaces: { defaultDestination: "last-used", lastUsed: {} },
  notifications: { agent: false, permissions: true, questions: true, errors: false },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    questionsEnabled: true,
    questions: "staplebops-05",
    errorsEnabled: true,
    errors: "nope-03",
    interfaceEnabled: true,
  },
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

/** Only local/dev desktop builds offer the Recent side-tab organization. */
export function recentSessionsAvailable(platform: "web" | "desktop", channel: ImportMetaEnv["VITE_OPENCODE_CHANNEL"]) {
  return platform === "desktop" && (channel === "local" || channel === "dev")
}

/** Projects moved to Consolidated where this build offers it (local/dev desktop), and to Customize elsewhere. */
export function resolveSidebarOrganize(
  value: Settings["general"]["sidebarOrganize"] | undefined,
  options: readonly SidebarOrganize[],
): SidebarOrganize {
  if (value === "projects") return options.includes("consolidated") ? "consolidated" : "customize"

  return value && options.includes(value) ? value : "list"
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  gate: false,
  init: () => {
    const [store, setStore, , ready] = persisted({ key: "settings.v3" }, settingsPersistence, defaultSettings)

    const prototypes = recentSessionsAvailable(usePlatform().platform, import.meta.env.VITE_OPENCODE_CHANNEL)

    const sidebarOrganizeOptions: SidebarOrganize[] = prototypes
      ? ["list", "customize", "recent", "consolidated"]
      : ["list", "customize"]

    const sidebarOrganize = createMemo(() =>
      resolveSidebarOrganize(store.general?.sidebarOrganize, sidebarOrganizeOptions),
    )

    const showCustomAgents = withFallback(
      () => store.general?.showCustomAgents,
      defaultSettings.general.showCustomAgents,
    )

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      const mono = monoFontFamily(store.appearance?.mono)
      root.style.setProperty("--font-family-mono", mono)
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
      // Inline code can first appear during history backfill. Load its selected
      // face with the shell so that font discovery does not resize that mount.
      void document.fonts?.load(`440 13px ${mono}`).catch(() => undefined)
    })

    const reduceMotion = withFallback(() => store.appearance?.reduceMotion, defaultSettings.appearance.reduceMotion)
    const systemReducedMotion = createMediaQuery("(prefers-reduced-motion: reduce)")

    // Motion styles key off this attribute instead of the media query so the setting can override the system.
    createEffect(() => {
      if (typeof document === "undefined") return
      const reduce = reduceMotion() === "system" ? systemReducedMotion() : reduceMotion() === "on"
      document.documentElement.dataset.motion = reduce ? "reduce" : "full"
    })

    const timelineWidth = withFallback(() => store.general?.timelineWidth, defaultSettings.general.timelineWidth)

    // The session column's width token keys off this attribute, so every surface sharing it follows the setting.
    createEffect(() => {
      if (typeof document === "undefined") return
      document.documentElement.dataset.timelineWidth = timelineWidth()
    })

    const autoApproveDefault = withFallback(
      () => store.permissions?.autoApprove,
      defaultSettings.permissions.autoApprove,
    )

    // A project's explicit choice, or undefined when it uses the default.
    const autoApproveOverride = (project: ScopedKey | undefined) =>
      project ? store.permissions?.autoApproveProjects?.[project] : undefined

    return {
      ready,
      get current() {
        return store
      },
      general: {
        timelineDetail: withFallback(() => store.general?.timelineDetail, defaultSettings.general.timelineDetail),
        setTimelineDetail(value: TimelineDetail) {
          setStore("general", "timelineDetail", structuredClone(unwrap(value)))
        },
        showCustomAgents,
        setShowCustomAgents(value: boolean) {
          setStore("general", "showCustomAgents", value)
        },
        showTurnDiffs: withFallback(() => store.general?.showTurnDiffs, defaultSettings.general.showTurnDiffs),
        setShowTurnDiffs(value: boolean) {
          setStore("general", "showTurnDiffs", value)
        },
        backgroundActivity: withFallback(
          () => store.general?.backgroundActivity,
          defaultSettings.general.backgroundActivity,
        ),
        setBackgroundActivity(value: BackgroundActivity) {
          setStore("general", "backgroundActivity", value)
        },
        timelineWidth,
        setTimelineWidth(value: TimelineWidth) {
          setStore("general", "timelineWidth", value)
        },
        foldUserMessages: withFallback(() => store.general?.foldUserMessages, defaultSettings.general.foldUserMessages),
        setFoldUserMessages(value: boolean) {
          setStore("general", "foldUserMessages", value)
        },
        wrapCodeBlocks: withFallback(() => store.general?.wrapCodeBlocks, defaultSettings.general.wrapCodeBlocks),
        setWrapCodeBlocks(value: boolean) {
          setStore("general", "wrapCodeBlocks", value)
        },
        newTimeline: withFallback(() => store.general?.newTimeline, false),
        setNewTimeline(value: boolean) {
          setStore("general", "newTimeline", value)
        },
        tabGroups: withFallback(
          () => store.general?.tabGroups,
          import.meta.env.DEV && import.meta.env.VITE_OPENCODE_TEST_FIXTURES !== "1",
        ),
        setTabGroups(value: boolean) {
          setStore("general", "tabGroups", value)
        },
        sharedSidePanel: withFallback(() => store.general?.sharedSidePanel, false),
        setSharedSidePanel(value: boolean) {
          setStore("general", "sharedSidePanel", value)
        },
        newQuestionUI: withFallback(() => store.general?.newQuestionUI, defaultSettings.general.newQuestionUI),
        setNewQuestionUI(value: boolean) {
          setStore("general", "newQuestionUI", value)
        },
        sidebarOrganizeOptions,
        sidebarOrganize,
        setSidebarOrganize(value: SidebarOrganize) {
          setStore("general", "sidebarOrganize", value)
        },
        mobileTitlebarPosition: withFallback(
          () => store.general?.mobileTitlebarPosition,
          defaultSettings.general.mobileTitlebarPosition,
        ),
        setMobileTitlebarPosition(value: "top" | "bottom") {
          setStore("general", "mobileTitlebarPosition", value)
        },
        followUpBehavior: withFallback(() => store.general?.followUpBehavior, defaultSettings.general.followUpBehavior),
        setFollowUpBehavior(value: FollowUpBehavior) {
          setStore("general", "followUpBehavior", value)
        },
        questionSubmitKey: withFallback(
          () => store.general?.questionSubmitKey,
          defaultSettings.general.questionSubmitKey,
        ),
        setQuestionSubmitKey(value: QuestionSubmitKey) {
          setStore("general", "questionSubmitKey", value)
        },
      },
      visibility: {
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
        // The List layout always uses the sidebar, and the prototype has no Inbox, so both read as side tabs.
        tabLayout: createMemo((): TabLayout => {
          const stored = store.appearance?.tabLayout ?? defaultSettings.appearance.tabLayout
          const prototype = sidebarOrganize() === "consolidated"

          if (prototype && (store.appearance?.navigation === "list" || stored === "inbox")) return "vertical"

          return stored
        }),
        /** Where tabs go when the prototype's Tabs layout is chosen, whatever the List layout forces meanwhile. */
        tabPosition: createMemo(() => (store.appearance?.tabLayout === "horizontal" ? "horizontal" : "vertical")),
        setTabLayout(value: TabLayout) {
          setStore("appearance", "tabLayout", value)
        },
        /** The navigation prototype (Experimental → Consolidated): pinned sessions and groups, and Tabs or List. */
        navigationPrototype: createMemo(() => sidebarOrganize() === "consolidated"),
        navigation: createMemo(() =>
          sidebarOrganize() === "consolidated" && store.appearance?.navigation === "list" ? "list" : "tabs",
        ),
        setNavigation(value: "tabs" | "list") {
          setStore("appearance", "navigation", value)
        },
        sidebarOpen: withFallback(() => store.appearance?.sidebarOpen, true),
        setSidebarOpen(value: boolean) {
          setStore("appearance", "sidebarOpen", value)
        },
        reduceMotion,
        setReduceMotion(value: ReduceMotion) {
          setStore("appearance", "reduceMotion", value)
        },
      },
      keybinds: {
        all: () => store.keybinds ?? {},
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          // A returned object would merge into the stored one, keeping the key; delete it on the store itself.
          setStore(
            "keybinds",
            produce((draft) => {
              delete draft[action]
            }),
          )
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      permissions: {
        autoApproveDefault,
        setAutoApproveDefault(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
        autoApproveOverride,
        // Undefined makes the project use the default again.
        setAutoApproveOverride(project: ScopedKey, value: boolean | undefined) {
          const projects = { ...store.permissions?.autoApproveProjects }

          if (value === undefined) delete projects[project]
          else projects[project] = value
          setStore("permissions", "autoApproveProjects", reconcile(projects))
        },
        // Whether a project's requests are approved without asking.
        autoApproves: (project: ScopedKey | undefined) => autoApproveOverride(project) ?? autoApproveDefault(),
        // Whether any request on the server may be approved without asking.
        autoApprovesOnServer(scope: ServerScope) {
          if (autoApproveDefault()) return true
          const prefix = ScopedKey.prefix(scope)

          return Object.entries(store.permissions?.autoApproveProjects ?? {}).some(
            ([key, value]) => value && key.startsWith(prefix),
          )
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
        questions: withFallback(() => store.notifications?.questions, defaultSettings.notifications.questions),
        setQuestions(value: boolean) {
          setStore("notifications", "questions", value)
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
        questionsEnabled: withFallback(() => store.sounds?.questionsEnabled, defaultSettings.sounds.questionsEnabled),
        setQuestionsEnabled(value: boolean) {
          setStore("sounds", "questionsEnabled", value)
        },
        questions: withFallback(() => store.sounds?.questions, defaultSettings.sounds.questions),
        setQuestions(value: string) {
          setStore("sounds", "questions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
        interfaceEnabled: withFallback(
          () => store.sounds?.interfaceEnabled,
          defaultSettings.sounds.interfaceEnabled ?? true,
        ),
        setInterfaceEnabled(value: boolean) {
          setStore("sounds", "interfaceEnabled", value)
        },
      },
    }
  },
})
