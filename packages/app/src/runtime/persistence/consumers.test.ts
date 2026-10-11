import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { Agent } from "@opencode/schema/agent"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkspaceOnboardingSchema, ProviderTipSchema, WorkspaceTipSchema } from "@/new-session/view"
import { ModelSelectionSchema } from "@/providers/models/selection"
import { Persistence } from "@/runtime/persistence/schema"
import { FileViewsSchema } from "@/workspaces/files/view-cache"
import { languageSchema } from "@/runtime/i18n/language"
import { HomeServersSchema } from "@/home/projects/controller"
import { ModelProvidersSchema } from "@/settings/models/models"
import { NotificationStore, type Notification } from "@/shell/notifications/notification"
import { IconState, ProjectState, VcsState } from "@/runtime/server/persistence"

function stored<S extends Schema.ConstraintCodec<object, unknown>>(
  name: string,
  schema: S,
  initial: NoInfer<S["Type"]>,
  cases: [unknown, unknown][],
) {
  const codec = Persistence.withInitial(schema, initial)

  return { name, decode: Schema.decodeUnknownSync(codec), encode: Schema.encodeUnknownSync(codec), cases }
}

const notifications: Notification[] = [
  { type: "turn-complete", time: 123, viewed: false, session: "session-1" },
  { type: "error", time: 124, viewed: true, error: { type: "api", message: "failed", status: 500 } },
]

const collapsed = [
  [{}, { collapsed: {} }],
  [{ collapsed: [] }, { collapsed: {} }],
  [
    { collapsed: { open: false, closed: true, invalid: "false" } },
    { collapsed: { open: false, closed: true, invalid: false } },
  ],
] satisfies [unknown, unknown][]

describe("persisted consumer schemas", () => {
  test.each([
    stored("workspace onboarding", WorkspaceOnboardingSchema, { used: false }, [
      [{}, { used: false }],
      [{ used: "true" }, { used: false }],
      [{ used: true }, { used: true }],
    ]),
    stored("provider tip", ProviderTipSchema, { dismissedAt: 0 }, [
      [{}, { dismissedAt: 0 }],
      [{ dismissedAt: "yesterday" }, { dismissedAt: 0 }],
      [{ dismissedAt: Infinity }, { dismissedAt: 0 }],
      [{ dismissedAt: 123 }, { dismissedAt: 123 }],
    ]),
    stored("workspace tip", WorkspaceTipSchema, { dismissedAt: 0 }, [[{ dismissedAt: 123 }, { dismissedAt: 123 }]]),
    stored("home server collapse", HomeServersSchema, { collapsed: {} }, collapsed),
    stored("model provider collapse", ModelProvidersSchema, { collapsed: {} }, collapsed),
    stored("notifications", NotificationStore, { list: [] }, [
      [
        {
          list: [
            notifications[0],
            null,
            { type: "unknown", time: 123, viewed: false },
            { ...notifications[1], error: "invalid" },
            notifications[1],
          ],
        },
        { list: notifications },
      ],
      [{}, { list: [] }],
      [{ list: {} }, { list: [] }],
    ]),
    stored("VCS cache", VcsState, { value: undefined }, [
      [{}, { value: undefined }],
      [{ value: null }, { value: undefined }],
      [{ value: { branch: 1 } }, { value: undefined }],
      [{ value: { default_branch: "main" } }, { value: { default_branch: "main" } }],
      [
        { value: { branch: "feature", default_branch: "main", obsolete: true } },
        { value: { branch: "feature", default_branch: "main" } },
      ],
    ]),
    stored("project cache", ProjectState, { value: undefined }, [
      [{}, { value: undefined }],
      [{ value: [] }, { value: undefined }],
      [{ value: { icon: { override: 1 } } }, { value: undefined }],
      [{ value: { commands: { start: false } } }, { value: undefined }],
      [{ value: {} }, { value: {} }],
      [
        {
          value: {
            name: "Project",
            icon: { override: "data:image/png;base64,abc", color: "blue" },
            commands: { start: "bun dev" },
          },
        },
        {
          value: {
            name: "Project",
            icon: { override: "data:image/png;base64,abc", color: "blue" },
            commands: { start: "bun dev" },
          },
        },
      ],
    ]),
    stored("icon cache", IconState, { value: undefined }, [
      [{}, { value: undefined }],
      [{ value: 42 }, { value: undefined }],
      [{ value: null }, { value: undefined }],
      [{ value: "" }, { value: "" }],
      [{ value: "data:image/png;base64,abc" }, { value: "data:image/png;base64,abc" }],
    ]),
  ])("$name defaults missing or invalid values and round-trips valid ones", (row) => {
    row.cases.forEach(([input, expected]) => {
      const value = row.decode(input)
      expect<unknown>(value).toEqual(expected)
      expect(row.decode(row.encode(value))).toEqual(value)
    })
  })

  test("current model selections take precedence over legacy picks", () => {
    const decode = Schema.decodeUnknownSync(Persistence.withInitial(ModelSelectionSchema, { session: {} }))
    expect(decode({})).toEqual({ session: {} })
    expect(decode({ session: {}, pick: { session1: { agent: "plan" } } })).toEqual({ session: {} })
  })

  test("model selection validates nested model keys and preserves explicit null variants", () => {
    const state = Schema.decodeUnknownSync(Persistence.withInitial(ModelSelectionSchema, { session: {} }))({
      session: {
        good: {
          agent: Agent.ID.make("build"),
          model: {
            providerID: Provider.ID.make("provider"),
            modelID: Model.ID.make("model"),
            variant: Model.VariantID.make("high"),
          },
          variant: null,
        },
        partial: { agent: "plan", model: { providerID: Provider.ID.make("provider"), modelID: 42 }, variant: false },
        invalid: "build",
      },
    })

    expect<unknown>(state.session.good).toEqual({
      agent: "build",
      model: {
        providerID: "provider",
        modelID: "model",
        variant: Model.VariantID.make("high"),
      },
      variant: null,
    })
    expect<unknown>(state.session.partial?.agent).toBe("plan")
    expect(state.session.partial?.model).toBeUndefined()
    expect(state.session.partial?.variant).toBeUndefined()
    expect(state.session.invalid).toBeUndefined()
  })

  test("file views validate scroll positions and line sides independently", () => {
    const decode = Schema.decodeUnknownSync(Persistence.withInitial(FileViewsSchema, { file: {} }))
    expect(decode({})).toEqual({ file: {} })

    const state = decode({
      file: {
        good: {
          scrollTop: 12,
          scrollLeft: 4,
          selectedLines: { start: 9, end: 2, side: "deletions", endSide: "additions" },
        },
        partial: { scrollTop: "12", scrollLeft: 8, selectedLines: { start: 1, end: 3, side: "invalid" } },
        cleared: { selectedLines: null },
        invalid: false,
      },
    })

    expect(state.file.good).toEqual({
      scrollTop: 12,
      scrollLeft: 4,
      selectedLines: { start: 9, end: 2, side: "deletions", endSide: "additions" },
    })
    expect(state.file.partial?.scrollTop).toBeUndefined()
    expect(state.file.partial?.scrollLeft).toBe(8)
    expect(state.file.partial?.selectedLines).toEqual({ start: 1, end: 3 })
    expect(state.file.cleared?.selectedLines).toBeNull()
    expect(state.file.invalid).toEqual({})
  })

  test("language preserves runtime defaults and normalizes unsupported locales to English", () => {
    const decode = Schema.decodeUnknownSync(Persistence.withInitial(languageSchema, { locale: "fr" }))
    expect(decode({})).toEqual({ locale: "fr" })
    expect(decode({ locale: undefined })).toEqual({ locale: "fr" })
    expect(decode({ locale: 42 })).toEqual({ locale: "fr" })
    expect(decode({ locale: "unsupported" })).toEqual({ locale: "en" })
    expect(decode({ locale: "ar" })).toEqual({ locale: "ar" })
  })
})
