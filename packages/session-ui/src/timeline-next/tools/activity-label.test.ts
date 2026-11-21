import { describe, expect, test } from "bun:test"
import { useI18n } from "@opencode/ui/context/i18n"
import { summarize } from "../../timeline/facts"
import { labelGroups } from "../../timeline/group-label-fixtures"
import { activityFacts, activityLabel, activityText, usedLabel } from "./activity-label"

// Pins the labels the New timeline's groups show, so moving their counting does not change a word.

const i18n = useI18n()

describe("group labels", () => {
  test("the New timeline names a group by what it did", () => {
    expect(
      Object.fromEntries(
        Object.entries(labelGroups).map(([name, parts]) => [
          name,
          (activityText(activityLabel(parts, i18n)) ?? usedLabel(parts, i18n)).text,
        ]),
      ),
    ).toMatchSnapshot()
  })

  test("background shells count once, as how they ended", () => {
    expect(summarize(activityFacts(labelGroups["shells with background outcomes"]!)).background).toMatchSnapshot()
  })
})
