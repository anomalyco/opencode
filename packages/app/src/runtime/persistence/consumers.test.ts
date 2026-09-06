import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkspaceOnboardingSchema, ProviderTipSchema } from "@/new-session/view"
import { ModelSelectionSchema } from "@/providers/models/selection"
import { Persistence } from "@/runtime/persistence/schema"
import { FileViewsSchema } from "@/workspaces/files/view-cache"
import { languageSchema } from "@/runtime/i18n/language"
import { HomeServersSchema } from "@/home/projects/controller"
import { ModelProvidersSchema } from "@/settings/models/models"

describe("persisted consumer schemas", () => {
  test("onboarding and provider tip retain defaults and validate stored values", () => {
    const onboarding = Schema.decodeUnknownSync(Persistence.withInitial(WorkspaceOnboardingSchema, { used: false }))
    const tip = Schema.decodeUnknownSync(Persistence.withInitial(ProviderTipSchema, { dismissedAt: 0 }))
    expect(onboarding({})).toEqual({ used: false })
    expect(onboarding({ used: "true" })).toEqual({ used: false })
    expect(onboarding({ used: true })).toEqual({ used: true })
    expect(tip({})).toEqual({ dismissedAt: 0 })
    expect(tip({ dismissedAt: "yesterday" })).toEqual({ dismissedAt: 0 })
    expect(tip({ dismissedAt: Infinity })).toEqual({ dismissedAt: 0 })
    expect(tip({ dismissedAt: 123 })).toEqual({ dismissedAt: 123 })
  })

  test("collapse records recover malformed entries without losing valid siblings", () => {
    for (const schema of [HomeServersSchema, ModelProvidersSchema]) {
      const decode = Schema.decodeUnknownSync(Persistence.withInitial(schema, { collapsed: {} }))
      expect(decode({})).toEqual({ collapsed: {} })
      expect(decode({ collapsed: [] })).toEqual({ collapsed: {} })
      expect(decode({ collapsed: { open: false, closed: true, invalid: "false" } })).toEqual({
        collapsed: { open: false, closed: true, invalid: false },
      })
    }
  })

  test("model selection migrates legacy picks and omits workspace state", () => {
    const decode = Schema.decodeUnknownSync(Persistence.withInitial(ModelSelectionSchema, { session: {} }))
    expect(decode({})).toEqual({ session: {} })
    const state = decode({ pick: { __workspace__: { agent: "plan" }, session1: { agent: "build" } } })
    expect(state.session.session1?.agent).toBe("build")
    expect(state.session.__workspace__).toBeUndefined()
    const encoded = Schema.encodeSync(
      Schema.fromJsonString(Persistence.withInitial(ModelSelectionSchema, { session: {} })),
    )(state)
    expect(JSON.parse(encoded)).toEqual({ session: { session1: { agent: "build" } } })
    expect(decode(JSON.parse(encoded))).toEqual(state)
  })

  test("current model selections take precedence over legacy picks", () => {
    expect(
      Schema.decodeUnknownSync(Persistence.withInitial(ModelSelectionSchema, { session: {} }))({
        session: {},
        pick: { session1: { agent: "plan" } },
      }),
    ).toEqual({ session: {} })
  })

  test("model selection validates nested model keys and preserves explicit null variants", () => {
    const state = Schema.decodeUnknownSync(Persistence.withInitial(ModelSelectionSchema, { session: {} }))({
      session: {
        good: { agent: "build", model: { providerID: "provider", modelID: "model", variant: "high" }, variant: null },
        partial: { agent: "plan", model: { providerID: "provider", modelID: 42 }, variant: false },
        invalid: "build",
      },
    })
    expect(state.session.good).toEqual({
      agent: "build",
      model: { providerID: "provider", modelID: "model", variant: "high" },
      variant: null,
    })
    expect(state.session.partial?.agent).toBe("plan")
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
