import { describe, expect, test } from "bun:test"
import { visionFallbackConfigRows } from "../../src/component/dialog-config-flow"

const global = { providerID: "ollama-cloud", modelID: "gemma4:31b" }
const override = { providerID: "p", modelID: "v" }

describe("dialog-config-flow visionFallbackConfigRows", () => {
  test("vision-capable models get an informational row only", () => {
    expect(
      visionFallbackConfigRows({
        visionCapable: true,
        global,
        perModelEntry: undefined,
      }),
    ).toEqual([
      {
        value: "__vision_capable__",
        title: "No fallback needed (vision-capable)",
      },
    ])
  })

  test("text-only with no per-model entry shows Set without suffix when global unset", () => {
    expect(
      visionFallbackConfigRows({
        visionCapable: false,
        global: undefined,
        perModelEntry: undefined,
      }),
    ).toEqual([
      {
        value: "set-model-fallback",
        title: "Set fallback vision model",
      },
    ])
  })

  test("text-only with inherited global shows Set suffix and opt-out", () => {
    expect(
      visionFallbackConfigRows({
        visionCapable: false,
        global,
        perModelEntry: undefined,
      }),
    ).toEqual([
      {
        value: "set-model-fallback",
        title: "Set fallback vision model (global: ollama-cloud/gemma4:31b)",
      },
      {
        value: "opt-out-model-fallback",
        title: "Disable vision fallback for this model",
      },
    ])
  })

  test("text-only with per-model override shows Clear with target", () => {
    expect(
      visionFallbackConfigRows({
        visionCapable: false,
        global,
        perModelEntry: override,
      }),
    ).toEqual([
      {
        value: "clear-model-fallback",
        title: "Clear fallback vision model: p/v",
      },
    ])
  })

  test("text-only with null opt-out shows Clear (none)", () => {
    expect(
      visionFallbackConfigRows({
        visionCapable: false,
        global,
        perModelEntry: null,
      }),
    ).toEqual([
      {
        value: "clear-model-fallback",
        title: "Clear fallback vision model: (none)",
      },
    ])
  })
})
