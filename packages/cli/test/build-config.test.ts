import { describe, expect, test } from "bun:test"
import { buildTargets, simulationExternals, targetName } from "../script/build-config"

describe("published Bun build configuration", () => {
  test("externalizes the simulation package and every subpath", () => {
    expect(simulationExternals).toEqual(["@opencode-ai/simulation", "@opencode-ai/simulation/*"])
  })

  test("covers every configured target with the same production build", () => {
    expect(buildTargets.map((target) => targetName(target))).toEqual([
      "opencode2-linux-arm64",
      "opencode2-linux-x64",
      "opencode2-linux-x64-baseline",
      "opencode2-linux-arm64-musl",
      "opencode2-linux-x64-musl",
      "opencode2-linux-x64-baseline-musl",
      "opencode2-darwin-arm64",
      "opencode2-darwin-x64",
      "opencode2-darwin-x64-baseline",
      "opencode2-windows-arm64",
      "opencode2-windows-x64",
      "opencode2-windows-x64-baseline",
    ])
  })
})
