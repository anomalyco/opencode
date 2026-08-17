/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { ImageRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { SessionMessageAssistantFile } from "@opencode-ai/client"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { GeneratedFile } from "../../../src/routes/session"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg=="
let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

test("renders generated image files through the terminal image protocol", async () => {
  setup = await render(generated({ mime: "image/png", url: `data:image/png;base64,${PNG_1X1_BASE64}` }))

  const image = setup.renderer.root.findDescendantById("session-generated-image-generated-message-0")
  if (!(image instanceof ImageRenderable)) throw new Error("Generated image did not render")
  await image.loadPromise

  expect(image.fit).toBe("fit")
  expect(image.protocol).toBe("auto")
  expect(image.height).toBe(18)
  expect(setup.captureCharFrame()).toContain("Generated file: generated-message-0.png")
})

test("keeps non-image generated files as text", async () => {
  setup = await render(generated({ mime: "text/plain", url: "data:text/plain;base64,SGVsbG8=" }))

  expect(setup.renderer.root.findDescendantById("session-generated-image-generated-message-0")).toBeUndefined()
  expect(setup.captureCharFrame()).toContain("Generated file: generated-message-0.png")
})

test("does not add one resize listener per generated file", async () => {
  setup = await render(
    ...Array.from({ length: 12 }, () =>
      generated({ mime: "text/plain", url: "data:text/plain;base64,SGVsbG8=" }),
    ),
  )

  expect(setup.renderer.listenerCount("resize")).toBe(0)
})

async function render(...parts: SessionMessageAssistantFile[]) {
  const value = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
            {parts.map((part) => (
              <GeneratedFile part={part} width={80} />
            ))}
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
  )
  value.renderer.start()
  await value.waitForFrame((frame) => frame.includes("Generated file: generated-message-0.png"))
  return value
}

function generated(input: Pick<SessionMessageAssistantFile, "mime" | "url">): SessionMessageAssistantFile {
  return {
    type: "file",
    id: "generated-message-0",
    filename: "generated-message-0.png",
    ...input,
  }
}
