import { beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { DesktopTool, resolveNutJsImportSpecifier } from "../../src/tool/desktop"
import { SessionID, MessageID } from "../../src/session/schema"

const calls: unknown[][] = []

mock.module("@nut-tree-fork/nut-js", () => ({
  keyboard: {
    type: async (...input: unknown[]) => {
      calls.push(input)
    },
  },
  screen: {
    grab: async () => ({
      width: 1,
      height: 1,
      data: Buffer.from([255, 0, 0, 255]),
      colorMode: undefined,
    }),
    width: async () => 1,
    height: async () => 1,
  },
  Key: {
    LeftSuper: "LeftSuper",
    LeftControl: "LeftControl",
    LeftAlt: "LeftAlt",
    LeftShift: "LeftShift",
    Space: "Space",
  },
}))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

beforeEach(() => {
  calls.length = 0
})

describe("resolveNutJsImportSpecifier", () => {
  test("uses a real on-disk helper when running from Bun's compiled filesystem", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-"))
    const execPath = path.join(tempDir, "opencode")
    const helperPath = path.join(tempDir, "desktop.runtime.mjs")

    await fs.writeFile(execPath, "")
    await fs.writeFile(helperPath, "export default { marker: 'desktop-runtime-helper' }")

    const specifier = resolveNutJsImportSpecifier("file:///$bunfs/root/src/cli/cmd/tui/worker.js", execPath)
    const expectedHelperPath = pathToFileURL(await fs.realpath(helperPath)).href

    expect(specifier).toBe(expectedHelperPath)

    const loaded = await import(specifier)
    expect(loaded.default.marker).toBe("desktop-runtime-helper")
  })

  test("uses the package import during normal source runtime", () => {
    expect(resolveNutJsImportSpecifier("file:///tmp/opencode/src/tool/desktop.ts", "/usr/local/bin/bun")).toBe(
      "@nut-tree-fork/nut-js",
    )
  })
})

describe("DesktopTool", () => {
  test("clicks a modifier key", async () => {
    const desktop = await DesktopTool.init()
    const result = await desktop.execute({ action: "key_click", key: "cmd" }, ctx)

    expect(calls).toEqual([["LeftSuper"]])
    expect(result.output).toContain("cmd")
  })

  test("clicks a shortcut with modifiers", async () => {
    const desktop = await DesktopTool.init()
    const result = await desktop.execute({ action: "key_click", key: "space", modifiers: ["cmd"] }, ctx)

    expect(calls).toEqual([["LeftSuper", "Space"]])
    expect(result.output).toContain("cmd+space")
  })

  test("returns a PNG attachment for screenshots", async () => {
    const desktop = await DesktopTool.init()
    const result = await desktop.execute({ action: "screenshot" }, ctx)

    expect(result.output).toContain("1x1")
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments?.[0]?.type).toBe("file")
    expect(result.attachments?.[0]?.mime).toBe("image/png")
    expect(result.attachments?.[0]?.url.startsWith("data:image/png;base64,")).toBe(true)
  })
})
