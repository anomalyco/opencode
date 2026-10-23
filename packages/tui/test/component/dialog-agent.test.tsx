import { expect, test } from "bun:test"
import { DialogAgent, sortAgentOptions } from "../../src/component/dialog-agent"
import { agent, renderLocal } from "../fixture/local"

test("sortAgentOptions lists selectable agents before subagents, alphabetical within each group", () => {
  const sorted = sortAgentOptions([
    { ...agent("zeta"), mode: "subagent" },
    agent("review"),
    { ...agent("alpha"), mode: "subagent" },
    agent("build"),
    { ...agent("middle"), mode: "all" },
  ])
  expect(sorted.map((item) => item.id)).toEqual(["build", "middle", "review", "alpha", "zeta"])
})

test("agent dialog renders agents in sorted order", async () => {
  await using setup = await renderLocal({
    agents: [agent("mango"), agent("aardvark"), agent("zeppelin"), agent("baklava")],
  })
  setup.dialog.replace(() => <DialogAgent />)
  let frame = ""
  await setup.waitForFrame((current) => {
    frame = current
    return frame.includes("Select agent") && ["aardvark", "baklava", "mango", "zeppelin"].every((id) => frame.includes(id))
  })
  // The dialog is a modal overlay composited after the status chrome, so the last
  // occurrence of each id is its option row.
  const ids = ["aardvark", "baklava", "mango", "zeppelin"]
  const positions = ids.map((id) => frame.lastIndexOf(id))
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
})
