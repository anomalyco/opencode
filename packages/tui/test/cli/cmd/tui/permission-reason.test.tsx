/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { TuiConfigProvider } from "../../../../src/config"
import { LocationProvider } from "../../../../src/context/location"
import { ThemeProvider } from "../../../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../../src/keymap"
import { PermissionPrompt } from "../../../../src/routes/session/permission"
import { tmpdir } from "../../../fixture/fixture"
import { createTuiResolvedConfig } from "../../../fixture/tui-runtime"
import { mount } from "./sync-fixture"

test.each([undefined, "", " \t\n", "Read configuration for this change.", "<b>Read config</b> **literally**"])(
  "permission prompt renders optional reason %j alongside the scope",
  async (reason) => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "kv.json"), "{}")
    const config = createTuiResolvedConfig()
    const ready = Promise.withResolvers<void>()

    function Body() {
      onMount(ready.resolve)
      return (
        <LocationProvider>
          <PermissionPrompt
            request={{
              id: "permission-reason",
              sessionID: "session-reason",
              permission: "external_directory",
              patterns: ["/external/config/*"],
              always: ["/external/config/*"],
              metadata: {},
              reason,
            }}
          />
        </LocationProvider>
      )
    }

    function Prompt() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      onCleanup(registerOpencodeKeymap(keymap, renderer, config))
      return (
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <ThemeProvider mode="dark">
              <Body />
            </ThemeProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      )
    }

    const setup = await mount(undefined, tmp.path, () => <Prompt />)
    try {
      await ready.promise
      await setup.app.renderOnce()
      const frame = setup.app.captureCharFrame()
      expect(frame).toContain("/external/config/*")
      expect(frame).toContain("Allow once")
      expect(frame).toContain("Reject")
      if (reason?.trim()) {
        expect(frame).toContain("Reason:")
        expect(frame).toContain(reason)
        return
      }
      expect(frame).not.toContain("Reason:")
    } finally {
      setup.app.renderer.destroy()
    }
  },
)
