import { describe, expect, test } from "bun:test"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { syncSessionModel } from "./session-model-helpers"

const message = (input?: Partial<Pick<UserMessage, "agent" | "model" | "variant">>) =>
  ({
    id: "msg",
    sessionID: "session",
    role: "user",
    time: { created: 1 },
    agent: input?.agent ?? "build",
    model: input?.model ?? { providerID: "anthropic", modelID: "claude-sonnet-4" },
    variant: input?.variant,
  }) as UserMessage

describe("syncSessionModel", () => {
  test("restores the last message model and variant", () => {
    const calls: unknown[] = []

    syncSessionModel(
      {
        agent: {
          set(value) {
            calls.push(["agent", value])
          },
        },
        model: {
          set(value) {
            calls.push(["model", value])
          },
          current() {
            return { id: "claude-sonnet-4", provider: { id: "anthropic" } }
          },
          variant: {
            set(value) {
              calls.push(["variant", value])
            },
          },
        },
      },
      message({ variant: "high" }),
    )

    expect(calls).toEqual([
      ["agent", "build"],
      ["model", { providerID: "anthropic", modelID: "claude-sonnet-4" }],
      ["variant", "high"],
    ])
  })

  test("skips variant when the model falls back", () => {
    const calls: unknown[] = []

    syncSessionModel(
      {
        agent: {
          set(value) {
            calls.push(["agent", value])
          },
        },
        model: {
          set(value) {
            calls.push(["model", value])
          },
          current() {
            return { id: "gpt-5", provider: { id: "openai" } }
          },
          variant: {
            set(value) {
              calls.push(["variant", value])
            },
          },
        },
      },
      message({ variant: "high" }),
    )

    expect(calls).toEqual([
      ["agent", "build"],
      ["model", { providerID: "anthropic", modelID: "claude-sonnet-4" }],
    ])
  })
})
