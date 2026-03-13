import { expect, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { PermissionNext } from "../src/permission/next"
import { Log } from "../src/util/log"

test("evaluate logs the matched rule without serializing the full ruleset", async () => {
  const pattern = `permission-log-${Date.now()}`
  PermissionNext.evaluate("task", pattern, [
    {
      permission: "task",
      pattern: "*",
      action: "ask",
    },
    {
      permission: "task",
      pattern,
      action: "allow",
    },
  ])

  await sleep(50)

  const line = (await Bun.file(Log.file()).text())
    .trim()
    .split("\n")
    .findLast((x) => x.includes("service=permission") && x.includes(`pattern=${pattern}`))

  expect(line).toBeDefined()
  expect(line).toContain("rule=")
  expect(line).toContain("rules=2")
  expect(line).not.toContain("ruleset=")
})
