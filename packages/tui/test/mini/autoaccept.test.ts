import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { RunFooter } from "../../src/mini/footer"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"
import type { PermissionReply } from "../../src/mini/types"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const request = { id: "per_auto", sessionID: "ses_auto", action: "shell", resources: ["ls"], save: [] }

async function replies(permissions: "prompt" | "autoaccept", onReply?: () => Promise<void>) {
  const app = await createTestRenderer({ width: 40, height: 10, screenMode: "split-footer", footerHeight: 4 })
  const sent: PermissionReply[] = []
  const footer = new RunFooter(app.renderer, {
    directory: () => "/project",
    findFiles: async () => [],
    agents: [],
    references: [],
    agent: undefined,
    modelLabel: "GPT-5",
    model: undefined,
    variant: undefined,
    first: false,
    theme: RUN_THEME_FALLBACK,
    tuiConfig: createTuiResolvedConfig({ session: { ...createTuiResolvedConfig().session, permissions } }),
    miniSettings: {
      current: {
        thinking: "hide",
        tools: "show",
        shell_output: "hide",
        turn_summary: "hide",
        footer: "show",
        splash: "hide",
        work_spinner: "block-soft-slide",
        mono: false,
      },
    },
    onPermissionReply: async (reply) => {
      sent.push(reply)
      await onReply?.()
    },
    onFormReply: () => {},
    onFormCancel: () => {},
    onEditorOpen: async () => undefined,
    subscribeThemeSignal: () => () => {},
  })
  try {
    footer.event({ type: "stream.view", view: { type: "permission", request } })
    await app.renderOnce()
    await Bun.sleep(0)
    await app.renderOnce()
    return { sent, frame: app.captureCharFrame() }
  } finally {
    footer.destroy()
    app.renderer.destroy()
  }
}

test("auto-accept replies once without showing the prompt", async () => {
  const result = await replies("autoaccept")
  expect(result.sent).toEqual([{ sessionID: "ses_auto", requestID: "per_auto", decision: "once" }])
  expect(result.frame).not.toContain("Allow once")
})

test("auto-accept falls back to the prompt when the reply fails", async () => {
  const result = await replies("autoaccept", () => Promise.reject(new Error("offline")))
  expect(result.frame).toContain("Allow once")
})

test("the prompt stays up without auto-accept", async () => {
  const result = await replies("prompt")
  expect(result.sent).toEqual([])
  expect(result.frame).toContain("Allow once")
})
