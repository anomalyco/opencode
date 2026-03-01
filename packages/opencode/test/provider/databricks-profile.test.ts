import { expect, test } from "bun:test"
import { Auth } from "../../src/auth"
import { parseDatabricksProfiles, pickDatabricksProfileFlow } from "../../src/provider/databricks-profile"

test("Databricks profile parsing: extracts section names", () => {
  const parsed = parseDatabricksProfiles(`
[staging]
host = https://staging.cloud.databricks.com

[DEFAULT]
host = https://prod.cloud.databricks.com

[dev]
host = https://dev.cloud.databricks.com
`)

  expect(parsed).toEqual(["DEFAULT", "dev", "staging"])
})

test("Databricks profile parsing: ignores non-section lines and deduplicates", () => {
  const parsed = parseDatabricksProfiles(`
host = https://missing-section.cloud.databricks.com
[team-a]
token = dapi***
[team-a]
[team-b]
`)

  expect(parsed).toEqual(["team-a", "team-b"])
})

test("Databricks profile flow: prompts when only one candidate exists", () => {
  const flow = pickDatabricksProfileFlow({
    profiles: ["DEFAULT"],
  })

  expect(flow).toEqual({ promptProfiles: ["DEFAULT"] })
})

test("Databricks profile flow: prompt when multiple profiles are available", () => {
  const flow = pickDatabricksProfileFlow({
    profiles: ["DEFAULT", "dev"],
  })

  expect(flow).toEqual({ promptProfiles: ["DEFAULT", "dev"] })
})

test("Databricks profile flow: fallback flow when no profiles exist", () => {
  const flow = pickDatabricksProfileFlow({ profiles: [] })

  expect(flow).toEqual({})
})

test("Databricks profile auth variant parses in Auth.Info", () => {
  const parsed = Auth.Info.safeParse({
    type: "databricks-profile",
    profile: "staging",
  })
  expect(parsed.success).toBe(true)
})
