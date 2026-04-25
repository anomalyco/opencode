import { expect, test } from "bun:test"
import { agentDialogTitle } from "../../../../src/cli/cmd/tui/component/dialog-agent"
import {
  agentAutocompleteAliases,
  agentAutocompleteDisplay,
  agentAutocompleteOption,
} from "../../../../src/cli/cmd/tui/component/prompt/autocomplete"
import { subagentLabelFromTitle } from "../../../../src/cli/cmd/tui/routes/session/subagent-footer"
import { subagentSessionTitle } from "../../../../src/tool/task"

test("dialog agent title displays clean label while raw value stays available", () => {
  const raw = "\u200Bprometheus"

  expect({ value: raw, title: agentDialogTitle(raw) }).toEqual({
    value: raw,
    title: "prometheus",
  })
})

test("autocomplete agent display uses clean mention", () => {
  expect(agentAutocompleteDisplay("\u200Bprometheus")).toBe("@prometheus")
})

test("autocomplete agent aliases include raw and display-safe mentions", () => {
  expect(agentAutocompleteAliases("\u200Bprometheus")).toEqual(["@\u200Bprometheus", "@prometheus"])
})

test("autocomplete agent aliases remove duplicate raw and display-safe mentions", () => {
  expect(agentAutocompleteAliases("build")).toEqual(["@build"])
})

test("autocomplete agent selection preserves raw name in prompt part", () => {
  const raw = "\u200Bprometheus"
  const selected: unknown[] = []
  const option = agentAutocompleteOption({ name: raw }, (text, part) => {
    selected.push({ text, part })
  })

  option.onSelect?.()

  expect(selected).toEqual([
    {
      text: raw,
      part: {
        type: "agent",
        name: raw,
        source: {
          start: 0,
          end: 0,
          value: "",
        },
      },
    },
  ])
})

test("subagent footer label falls back when title has no subagent marker", () => {
  expect(subagentLabelFromTitle("Search context")).toBe("Subagent")
})

test("subagent footer label cleans zero-width-prefixed hyphenated labels", () => {
  expect(subagentLabelFromTitle("Search context (@\u200Bprometheus-agent subagent)")).toBe("Prometheus-Agent")
})

test("subagent footer label supports spaced labels", () => {
  expect(subagentLabelFromTitle("Search context (@sisyphus ultraworker subagent)")).toBe("Sisyphus Ultraworker")
})

test("subagent footer label targets the final generated marker", () => {
  expect(subagentLabelFromTitle("Ask @build to Search (@Sisyphus - Ultraworker subagent)")).toBe(
    "Sisyphus - Ultraworker",
  )
})

test("subagent footer label supports exact spaced-plus-hyphen plan case", () => {
  expect(subagentLabelFromTitle("Search (@Sisyphus - Ultraworker subagent)")).toBe("Sisyphus - Ultraworker")
})

test("task title helper uses display-safe subagent mention", () => {
  expect(subagentSessionTitle("Search context", "\u200Bprometheus-agent")).toBe(
    "Search context (@prometheus-agent subagent)",
  )
})
