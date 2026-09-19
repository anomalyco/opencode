/** @jsxImportSource @opentui/solid */
import { test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { DialogProvider } from "../../../src/ui/dialog"
import { DialogPreview, DialogPreviewFile } from "../../../src/component/dialog-preview"
import { ProjectProvider } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { ThemeProvider } from "../../../src/context/theme"
import { ToastProvider } from "../../../src/ui/toast"
import { KVProvider } from "../../../src/context/kv"
import { TuiConfigProvider } from "../../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

async function waitUntilFrame(
  app: { captureCharFrame(): string },
  predicate: (frame: string) => boolean,
  timeout = 3000,
) {
  const start = Date.now()
  while (!predicate(app.captureCharFrame())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for frame content")
    await Bun.sleep(10)
  }
}

async function mountPreview(input: { path?: string; find?: string[]; content?: unknown; status?: number } = {}) {
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/find/file" && input.find) return json(input.find)
    if (url.pathname === "/file/content" && input.content !== undefined)
      return json(input.content, { status: input.status })
    return undefined
  }, events)

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
                    <ProjectProvider>
                      <DialogProvider>
                        {input.path !== undefined ? <DialogPreviewFile path={input.path} /> : <DialogPreview />}
                      </DialogProvider>
                    </ProjectProvider>
                  </SDKProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  return testRender(() => <Harness />, { kittyKeyboard: true })
}

test("renders markdown files as markdown", async () => {
  const app = await mountPreview({
    path: "README.md",
    content: { type: "text", content: "# Hello Preview\n\nSome body text." },
  })
  try {
    await waitUntilFrame(app, (frame) => frame.includes("Hello Preview"))
    await waitUntilFrame(app, (frame) => frame.includes("Some body text."))
  } finally {
    app.renderer.destroy()
  }
})

test("renders code files with syntax highlighting", async () => {
  const app = await mountPreview({
    path: "src/example.ts",
    content: { type: "text", content: "export const preview_marker = 1\n" },
  })
  try {
    await waitUntilFrame(app, (frame) => frame.includes("preview_marker"))
  } finally {
    app.renderer.destroy()
  }
})

test("shows a notice for binary files", async () => {
  const app = await mountPreview({
    path: "assets/logo.png",
    content: { type: "binary", content: "aGk=", encoding: "base64", mimeType: "image/png" },
  })
  try {
    await waitUntilFrame(app, (frame) => frame.includes("Binary file"))
  } finally {
    app.renderer.destroy()
  }
})

test("shows a notice when the file fails to load", async () => {
  const app = await mountPreview({
    path: "docs/missing.md",
    content: { message: "Bad request" },
    status: 400,
  })
  try {
    await waitUntilFrame(app, (frame) => frame.includes("Failed to load file"))
  } finally {
    app.renderer.destroy()
  }
})

test("picker opens a preview for the selected file", async () => {
  const app = await mountPreview({
    find: ["README.md", "docs/guide.md"],
    content: { type: "text", content: "# From the picker\n\nPicker body." },
  })
  try {
    await waitUntilFrame(app, (frame) => frame.includes("README.md"))
    await waitUntilFrame(app, (frame) => frame.includes("docs/guide.md"))
    app.mockInput.pressEnter()
    await waitUntilFrame(app, (frame) => frame.includes("From the picker"))
    await waitUntilFrame(app, (frame) => frame.includes("Picker body."))
  } finally {
    app.renderer.destroy()
  }
})

test("shows a notice for oversized files", async () => {
  const app = await mountPreview({
    path: "logs/big.log",
    content: { type: "text", content: "x".repeat(512 * 1024 + 1) },
  })
  try {
    await waitUntilFrame(app, (frame) => frame.includes("File too large to preview"))
  } finally {
    app.renderer.destroy()
  }
})
