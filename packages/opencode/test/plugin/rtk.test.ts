import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

const rewrite = mock(async (command: string) => (command.includes("git status") ? "rtk git status" : command))
const disabled = mock(() => false)
const ensure = mock(async () => "/tmp/rtk")

void mock.module("@/rtk/binary", () => ({
  RtkBinary: {
    disabled,
    ensure,
    rewrite,
  },
}))

const { rewriteCommand, RtkPlugin } = await import("../../src/plugin/rtk")

describe("plugin.rtk", () => {
  test("rewriteCommand delegates to bundled RTK binary", async () => {
    await expect(rewriteCommand("git status")).resolves.toBe("rtk git status")
    expect(rewrite).toHaveBeenCalledWith("git status", undefined)
  })

  test("tool.execute.before rewrites bash commands", async () => {
    const hooks = await RtkPlugin({} as PluginInput)
    const output = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "ses_test", callID: "call_test" },
      output,
    )
    expect(output.args.command).toBe("rtk git status")
  })

  test("tool.execute.before ignores non-shell tools", async () => {
    const hooks = await RtkPlugin({} as PluginInput)
    const output = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(
      { tool: "read", sessionID: "ses_test", callID: "call_test" },
      output,
    )
    expect(output.args.command).toBe("git status")
  })
})
