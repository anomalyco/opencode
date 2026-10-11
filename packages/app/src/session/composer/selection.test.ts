import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { Agent } from "@opencode/schema/agent"
import { describe, expect, test } from "bun:test"
import { resolveSessionComposerSelection } from "./selection"

describe("resolveSessionComposerSelection", () => {
  test("prefers durable Session state over historical message metadata", () => {
    expect<unknown>(
      resolveSessionComposerSelection(
        {
          agent: Agent.ID.make("build", { disableChecks: true }),
          model: {
            id: Model.ID.make("claude", { disableChecks: true }),
            providerID: Provider.ID.make("anthropic", { disableChecks: true }),
          },
        },
        { agent: "review", model: { modelID: "gpt", providerID: "openai" } },
      ),
    ).toEqual({
      agent: "build",
      model: {
        modelID: "claude",
        providerID: "anthropic",
        variant: undefined,
      },
    })
  })

  test("falls back to historical metadata while durable state is unavailable", () => {
    expect<unknown>(
      resolveSessionComposerSelection(undefined, {
        agent: "review",
        model: { modelID: "gpt", providerID: "openai", variant: "high" },
      }),
    ).toEqual({
      agent: "review",
      model: {
        modelID: "gpt",
        providerID: "openai",
        variant: Model.VariantID.make("high", { disableChecks: true }),
      },
    })
  })
})
