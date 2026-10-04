import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { describe, expect, test } from "bun:test"
import { formatRef, parse, switchLabel } from "../../src/util/model"

describe("util.model", () => {
  test("splits provider from a nested model identifier", () => {
    expect(parse("provider/org/model")).toEqual({
      providerID: Provider.ID.make("provider", { disableChecks: true }),
      modelID: Model.ID.make("org/model", { disableChecks: true }),
    })
    expect(parse("invalid")).toEqual({
      providerID: Provider.ID.make("invalid", { disableChecks: true }),
      modelID: Model.ID.make("", { disableChecks: true }),
    })
  })

  test("includes the selected variant in model refs", () => {
    expect(
      formatRef({
        providerID: Provider.ID.make("anthropic", { disableChecks: true }),
        id: "sonnet",
        variant: "thinking",
      }),
    ).toBe("anthropic/sonnet/thinking")
    expect(formatRef({ providerID: Provider.ID.make("anthropic", { disableChecks: true }), id: "sonnet" })).toBe(
      "anthropic/sonnet",
    )
  })

  test("includes the selected variant in model switch notices", () => {
    expect(
      switchLabel({
        providerID: Provider.ID.make("anthropic", { disableChecks: true }),
        id: "sonnet",
        variant: "thinking",
      }),
    ).toBe("Switched model to anthropic/sonnet/thinking")
  })

  test("uses the catalog display name in model switch notices", () => {
    const models = [
      { providerID: Provider.ID.make("openai", { disableChecks: true }), id: "gpt-5.5-fast", name: "GPT-5.5 Fast" },
      { providerID: Provider.ID.make("anthropic", { disableChecks: true }), id: "sonnet", name: "Claude Sonnet" },
    ]
    expect(
      switchLabel(
        { providerID: Provider.ID.make("openai", { disableChecks: true }), id: "gpt-5.5-fast", variant: "high" },
        models,
      ),
    ).toBe("Switched model to GPT-5.5 Fast (high)")
    expect(
      switchLabel({ providerID: Provider.ID.make("anthropic", { disableChecks: true }), id: "sonnet" }, models),
    ).toBe("Switched model to Claude Sonnet")
    expect(
      switchLabel(
        { providerID: Provider.ID.make("anthropic", { disableChecks: true }), id: "sonnet", variant: "default" },
        models,
      ),
    ).toBe("Switched model to Claude Sonnet")
    expect(
      switchLabel(
        { providerID: Provider.ID.make("removed", { disableChecks: true }), id: "gone", variant: "high" },
        models,
      ),
    ).toBe("Switched model to removed/gone/high")
  })

  test("distinguishes variant-only switches from model switches", () => {
    const previous = {
      providerID: Provider.ID.make("openai", { disableChecks: true }),
      id: "gpt-5.5",
      variant: "medium",
    }

    expect(switchLabel({ ...previous, variant: "high" }, undefined, previous)).toBe("Switched variant to high")
    expect(
      switchLabel(
        { providerID: Provider.ID.make("openai", { disableChecks: true }), id: "gpt-5.5" },
        undefined,
        previous,
      ),
    ).toBe("Switched variant to default")
    expect(
      switchLabel(
        { providerID: Provider.ID.make("anthropic", { disableChecks: true }), id: "sonnet", variant: "high" },
        undefined,
        previous,
      ),
    ).toBe("Switched model to anthropic/sonnet/high")
  })
})
