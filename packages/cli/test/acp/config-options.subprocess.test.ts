import type { SetSessionConfigOptionResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import {
  alternateValue,
  createAcpFixture,
  expectOk,
  flattenSelectOptions,
  initialize,
  newSession,
  requireSelectOption,
  selectConfigOption,
} from "./subprocess"

describe("acp config option subprocess", () => {
  test('model option is listed with category "model"', async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)
    const model = requireSelectOption((await newSession(acp, fixture.home)).configOptions, "model")

    expect(model.category).toBe("model")
    expect(model.currentValue).toBe("test/test-model")
    expect(flattenSelectOptions(model).length).toBeGreaterThanOrEqual(2)
  }, 60_000)

  test("model switch updates currentValue", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)
    const model = requireSelectOption(session.configOptions, "model")
    const nextModel = flattenSelectOptions(model).find((option) => option.value === "test/second-model")?.value
    expect(nextModel).toBe("test/second-model")

    const updated = expectOk(
      await acp.request<SetSessionConfigOptionResponse>("session/set_config_option", {
        sessionId: session.sessionId,
        configId: "model",
        value: nextModel,
      }),
    )

    expect(selectConfigOption(updated.configOptions, "model")?.currentValue).toBe(nextModel)
  }, 60_000)

  test('effort option is listed with category "thought_level" when selected model supports variants', async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)
    const effort = requireSelectOption((await newSession(acp, fixture.home)).configOptions, "effort")

    expect(effort.category).toBe("thought_level")
    expect(effort.currentValue).toBe("low")
    expect(flattenSelectOptions(effort).map((option) => option.value)).toEqual(["low", "high"])
  }, 60_000)

  test("effort switch updates currentValue", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)
    const nextEffort = alternateValue(requireSelectOption(session.configOptions, "effort"))

    const updated = expectOk(
      await acp.request<SetSessionConfigOptionResponse>("session/set_config_option", {
        sessionId: session.sessionId,
        configId: "effort",
        value: nextEffort,
      }),
    )

    expect(selectConfigOption(updated.configOptions, "effort")?.currentValue).toBe(nextEffort)
  }, 60_000)
})
