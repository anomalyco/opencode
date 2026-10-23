import { expect, test } from "bun:test"
import { resolveAgent } from "./agent"

const agents = [{ name: "plan" }, { name: "build" }, { name: "custom" }]

const rows: { name: string; agents: { name: string }[]; requested?: string; expected: string }[] = [
  { name: "the requested available agent", agents, requested: "custom", expected: "custom" },
  { name: "build without a request", agents, requested: undefined, expected: "build" },
  { name: "build for a missing agent", agents, requested: "missing", expected: "build" },
  {
    name: "the first agent when build is unavailable",
    agents: [{ name: "custom" }],
    requested: "missing",
    expected: "custom",
  },
]

test.each(rows)("resolveAgent uses $name", (row) => {
  expect(resolveAgent(row.agents, row.requested)?.name).toBe(row.expected)
})
