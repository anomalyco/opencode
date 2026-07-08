import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join, resolve } from "node:path"
import type { CliRenderer, Renderable } from "@opentui/core"
import { createMockKeys, createMockMouse, type MockInput, type MockMouse } from "@opentui/core/testing"
import type { SimulationProtocol } from "../protocol"
import { SimulationRenderer } from "./renderer"
import { SimulationPng } from "./png"

export type Action = SimulationProtocol.Frontend.Action
export type Element = SimulationProtocol.Frontend.Element

export interface Harness {
  readonly renderer: CliRenderer
  readonly mockInput: MockInput
  readonly mockMouse: MockMouse
  readonly renderOnce: () => Promise<void>
  readonly screen: () => string
}

type RenderBuffer = {
  readonly width: number
  readonly height: number
  getRealCharBytes(includeAnsi?: boolean): Uint8Array
}

const decoder = new TextDecoder()

function children(renderable: Renderable) {
  return renderable.getChildren().filter((child): child is Renderable => "num" in child)
}

function all(renderable: Renderable): Renderable[] {
  return [renderable, ...children(renderable).flatMap(all)]
}

function mouseListeners(renderable: Renderable) {
  const general = Reflect.get(renderable, "_mouseListener")
  const specific = Reflect.get(renderable, "_mouseListeners")
  return Boolean(general) || (specific && typeof specific === "object" && Object.keys(specific).length > 0)
}

function hit(renderer: CliRenderer, renderable: Renderable) {
  if (renderable.width <= 0 || renderable.height <= 0) return false
  const x = Math.floor(renderable.screenX + renderable.width / 2)
  const y = Math.floor(renderable.screenY + renderable.height / 2)
  return renderer.hitTest(x, y) === renderable.num
}

/**
 * Builds the harness the simulation server drives.
 *
 * When the renderer is the headless simulation renderer, its TestRendererSetup
 * provides the supported testing APIs. For the visible terminal renderer the
 * harness falls back to `requestRender` + `idle` and reading the private
 * `currentRenderBuffer`.
 */
export function createHarness(renderer: CliRenderer): Harness {
  const setup = SimulationRenderer.setupFor(renderer)
  return {
    renderer,
    mockInput: setup?.mockInput ?? createMockKeys(renderer),
    mockMouse: setup?.mockMouse ?? createMockMouse(renderer),
    renderOnce:
      setup?.renderOnce ??
      (async () => {
        renderer.requestRender()
        await renderer.idle()
      }),
    screen:
      setup?.captureCharFrame ??
      (() => decoder.decode((Reflect.get(renderer, "currentRenderBuffer") as RenderBuffer).getRealCharBytes(true))),
  }
}

export function elements(renderer: CliRenderer): Element[] {
  return all(renderer.root)
    .filter((renderable) => renderable.visible && !renderable.isDestroyed)
    .map((renderable) => {
      const clickable = mouseListeners(renderable) && hit(renderer, renderable)
      return {
        id: renderable.id,
        num: renderable.num,
        x: renderable.screenX,
        y: renderable.screenY,
        width: renderable.width,
        height: renderable.height,
        focusable: renderable.focusable,
        focused: renderable.focused,
        clickable,
        editor: renderer.currentFocusedEditor === renderable,
      } satisfies Element
    })
    .filter((element) => element.focusable || element.clickable || element.editor)
}

export function state(harness: Harness) {
  return {
    focused: {
      renderable: harness.renderer.currentFocusedRenderable?.num,
      editor: Boolean(harness.renderer.currentFocusedEditor),
    },
    elements: elements(harness.renderer),
  }
}

export async function screenshot(harness: Harness, name?: string) {
  await harness.renderOnce()
  const image = SimulationPng.screenshot(harness.renderer)
  const filename = name ?? `screenshot-${crypto.randomUUID()}`
  if (
    !filename ||
    filename.includes("/") ||
    filename.includes("\\") ||
    extname(filename)
  )
    throw new Error("screenshot name must not contain a path or extension")
  const directory = resolve(
    process.env.OPENCODE_DRIVE_MEDIA_DIR ??
      join(tmpdir(), "opencode-drive", "output"),
  )
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${filename}.png`)
  await Bun.write(path, image.data)
  return path
}

export async function execute(harness: Harness, action: Action) {
  switch (action.type) {
    case "ui.type":
      await harness.mockInput.typeText(action.text)
      break
    case "ui.press":
      harness.mockInput.pressKey(action.key, action.modifiers)
      break
    case "ui.enter":
      harness.mockInput.pressEnter()
      break
    case "ui.arrow":
      harness.mockInput.pressArrow(action.direction)
      break
    case "ui.focus":
      all(harness.renderer.root)
        .find((item) => item.num === action.target)
        ?.focus()
      break
    case "ui.click":
      await harness.mockMouse.click(action.x, action.y)
      break
  }
  await harness.renderOnce()
  return state(harness)
}

export * as SimulationActions from "./actions"
