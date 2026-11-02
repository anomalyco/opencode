import { describe, expect, test } from "bun:test"
import { goPlanModels } from "../src/component/go-models"
import { i18n } from "../src/i18n"
import { LOCALES } from "../src/lib/language"

describe("goPlanModels", () => {
  test("publishes Go, Go Plus, and Go Teams limits for every model", () => {
    expect(goPlanModels.length).toBeGreaterThan(0)
    for (const model of goPlanModels) {
      if (!Number.isFinite(model.allowance)) {
        expect(model.requests).toBe(Infinity)
        expect(model.plusRequests).toBe(Infinity)
        expect(model.plusAllowance).toBe(Infinity)
        expect(model.teamsRequests).toBe(Infinity)
        expect(model.teamsAllowance).toBe(Infinity)
        continue
      }
      expect(model.teamsAllowance).toBe(model.allowance + 5)
      expect(Number.isFinite(model.teamsRequests)).toBe(true)
      expect(model.teamsRequests).toBeGreaterThan(model.requests)
      expect(model.plusAllowance).toBeGreaterThan(model.teamsAllowance)
      expect(model.plusRequests).toBeGreaterThan(model.teamsRequests)
    }
  })

  test.each([...LOCALES])("translates Go Teams plan copy for %s", (locale) => {
    const dict = i18n(locale)
    for (const key of [
      "go.plans.audience",
      "go.plans.individuals",
      "go.plans.teams",
      "go.plans.memberMonth",
      "go.plans.teams.cta",
      "go.plans.teams.description",
      "go.plans.teams.feature1",
      "go.plans.teams.feature2",
      "go.plans.teams.feature3",
      "go.plans.teams.feature4",
      "go.plans.teams.feature5",
    ] as const) {
      expect(dict[key].length).toBeGreaterThan(0)
    }
    expect(dict["go.plans.teams.description"]).toContain("20")
  })
})
