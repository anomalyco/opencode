import { describe, expect, test } from "bun:test"
import { migrateModelSelection } from "./model-selection-migration"

describe("migrateModelSelection", () => {
  test("migrates persisted default sentinels to explicit Default", () => {
    expect(
      migrateModelSelection({
        session: {
          ses_default: { agent: "build", variant: "default" },
          ses_inherit: { agent: "build" },
        },
      }),
    ).toEqual({
      session: {
        ses_default: { agent: "build", variant: null },
        ses_inherit: { agent: "build" },
      },
    })
  })

  test("migrates legacy picks without the workspace entry", () => {
    expect(
      migrateModelSelection({
        pick: {
          __workspace__: { agent: "build", variant: "high" },
          ses_legacy: { agent: "plan", variant: "high" },
        },
      }),
    ).toEqual({ session: { ses_legacy: { agent: "plan", variant: "high" } } })
  })
})
