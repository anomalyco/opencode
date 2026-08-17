import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client/promise"
import { applyRunSelection } from "../../src/run/run"

afterEach(() => mock.restore())

describe("run selection", () => {
  test("resolves the configured model when an agent is explicit", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const select = spyOn(client.session, "select").mockResolvedValue(undefined)

    await applyRunSelection({ client, sessionID: "ses_test", agent: "modelprobe", explicit: false })

    expect(select).toHaveBeenCalledWith({
      sessionID: "ses_test",
      agent: "modelprobe",
      model: { type: "configured" },
    })
  })

  test("selects an explicit agent and model atomically", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const select = spyOn(client.session, "select").mockResolvedValue(undefined)

    await applyRunSelection({
      client,
      sessionID: "ses_test",
      agent: "modelprobe",
      model: { providerID: "opencode", id: "deepseek-v4-flash-free" },
      explicit: true,
    })

    expect(select).toHaveBeenCalledWith({
      sessionID: "ses_test",
      agent: "modelprobe",
      model: {
        type: "explicit",
        model: { providerID: "opencode", id: "deepseek-v4-flash-free" },
      },
    })
  })

  test("switches only the model when no agent is explicit", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const switchModel = spyOn(client.session, "switchModel").mockResolvedValue(undefined)

    await applyRunSelection({
      client,
      sessionID: "ses_test",
      model: { providerID: "opencode", id: "deepseek-v4-flash-free" },
      explicit: true,
    })

    expect(switchModel).toHaveBeenCalledWith({
      sessionID: "ses_test",
      model: { providerID: "opencode", id: "deepseek-v4-flash-free" },
    })
  })
})
