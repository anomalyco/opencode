import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { agent, renderLocal } from "../fixture/local"

test("applies the configured color to hidden agents", async () => {
  await using setup = await renderLocal({
    agents: [
      agent("build"),
      agent("plan"),
      { ...agent("planner"), hidden: true, color: "#ff6600" },
      { ...agent("worker"), hidden: true },
    ],
  })
  // The fix: a hidden agent's configured color is used instead of the palette default.
  expect(setup.local.agent.color("planner").equals(RGBA.fromHex("#ff6600"))).toBe(true)
  // Visible agents keep the same behavior: custom color wins, otherwise the palette slot.
  expect(setup.local.agent.color("plan").equals(setup.local.agent.color("planner"))).toBe(false)
  // Hidden agents without a configured color, and unknown ids, fall back to the palette default.
  expect(setup.local.agent.color("worker").equals(setup.local.agent.color("build"))).toBe(true)
  expect(setup.local.agent.color("missing").equals(setup.local.agent.color("build"))).toBe(true)
  // Hidden agents remain out of the selectable list.
  expect(setup.local.agent.list().map((item) => item.id)).toEqual(["build", "plan"])
})

test("applies the configured color to visible agents", async () => {
  await using setup = await renderLocal({
    agents: [agent("build"), { ...agent("plan"), color: "#112233" }],
  })
  expect(setup.local.agent.color("plan").equals(RGBA.fromHex("#112233"))).toBe(true)
})
