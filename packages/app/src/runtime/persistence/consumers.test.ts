import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkspaceOnboardingSchema, ProviderTipSchema } from "@/new-session/view"
import { ModelSelectionSchema } from "@/providers/models/selection"
import { Persistence } from "@/runtime/persistence/schema"
import { FileViewsSchema } from "@/workspaces/files/view-cache"
import { languageSchema } from "@/runtime/i18n/language"
import { HomeServersSchema } from "@/home/projects/controller"
import { ModelProvidersSchema } from "@/settings/models/models"
import { ProjectState, VcsState } from "@/runtime/server/persistence"

function stored<S extends Schema.ConstraintCodec<object, unknown>>(
  name: string,
  schema: S,
  initial: NoInfer<S["Type"]>,
  cases: [unknown, unknown][],
) {
  const codec = Persistence.withInitial(schema, initial)

  return { name, decode: Schema.decodeUnknownSync(codec), encode: Schema.encodeUnknownSync(codec), cases }
}

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
    stored("home server collapse", HomeServersSchema, { collapsed: {} }, collapsed),
    stored("model provider collapse", ModelProvidersSchema, { collapsed: {} }, collapsed),
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

  test("model selection reads saved model and variant pairs as choices and drops a variant without a model", () => {
    const codec = Persistence.withInitial(ModelSelectionSchema, { session: {} })
    const decode = Schema.decodeUnknownSync(codec)
    const model = { providerID: "provider", modelID: "model" }

    const state = decode({
      session: {
        named: { agent: "build", model: { ...model, variant: "low" }, variant: "high" },
        explicitDefault: { agent: "build", model, variant: null, choices: { plan: { model, variant: null } } },
        inherited: { model, choices: { plan: { variant: "high" }, build: { model } } },
        orphan: { agent: "build", variant: null },
        partial: { agent: "plan", model: { providerID: "provider", modelID: 42 }, variant: false },
        current: { agent: "plan", choice: { ...model, variant: { type: "named", value: "high" } } },
        invalid: "build",
      },
    })

    expect(state.session).toEqual({
      named: { agent: "build", choice: { ...model, variant: { type: "named", value: "high" } } },
      explicitDefault: {
        agent: "build",
        choice: { ...model, variant: { type: "default" } },
        choices: { plan: { ...model, variant: { type: "default" } } },
      },
      inherited: {
        choice: { ...model, variant: { type: "inherit" } },
        choices: { plan: undefined, build: { ...model, variant: { type: "inherit" } } },
      },
      orphan: { agent: "build" },
      partial: { agent: "plan" },
      current: { agent: "plan", choice: { ...model, variant: { type: "named", value: "high" } } },
      invalid: undefined,
    })
    expect(decode(Schema.encodeUnknownSync(codec)(state))).toEqual(state)
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
