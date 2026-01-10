import { describe, expect, test } from "bun:test"
import { Installation } from "../../src/installation"

describe("installation.brew migration", () => {
  test("no migration when already on anomalyco tap", () => {
    expect(Installation.getMigrationCommands("anomalyco/tap/opencode")).toBeNull()
  })

  test("sst tap suggests migrate to anomalyco tap", () => {
    expect(Installation.getMigrationCommands("sst/tap/opencode")).toEqual([
      "brew uninstall sst/tap/opencode",
      "brew install anomalyco/tap/opencode",
    ])
  })

  test("core formula suggests migrate to anomalyco tap", () => {
    expect(Installation.getMigrationCommands("opencode")).toEqual([
      "brew uninstall opencode",
      "brew install anomalyco/tap/opencode",
    ])
  })
})
