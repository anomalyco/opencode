import { tmpdir } from "node:os"
import { extname, join, resolve } from "node:path"
import type { CliRenderer, Renderable } from "@opentui/core"
import {
  createMockKeys,
  createMockMouse,
  KeyCodes,
  type KeyInput,
  type MockInput,
  type MockMouse,
} from "@opentui/core/testing"
import { Config, Effect, FileSystem, Schema } from "effect"
import { SimulationProtocol } from "../protocol"
import { SimulationRenderer } from "./renderer"
import { SimulationSemantics } from "./semantics"

export type Action = SimulationProtocol.Frontend.Action
export type Element = SimulationProtocol.Frontend.Element

export interface Harness {
  readonly renderer: CliRenderer
  readonly mockInput: MockInput
  readonly mockMouse: MockMouse
  readonly resize: (cols: number, rows: number) => void
  readonly renderOnce: () => Promise<void>
  readonly screen: () => string
}

type RenderBuffer = {
  readonly width: number
  readonly height: number
  getRealCharBytes(includeAnsi?: boolean): Uint8Array
}

const decoder = new TextDecoder()

function isKeyCode(key: string): key is keyof typeof KeyCodes {
  return Object.hasOwn(KeyCodes, key)
}

function keyInput(key: string): KeyInput {
  const named = key.toUpperCase()
  return isKeyCode(named) ? named : key
}

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
  const target = renderer.hitTest(x, y)
  return all(renderable).some((item) => item.num === target)
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
    resize: setup?.resize ?? ((cols, rows) => renderer.resize(cols, rows)),
    renderOnce:
      setup?.renderOnce ??
      (async () => {
        renderer.requestRender()
        await renderer.idle()
      }),
    // captureCharFrame follows the test renderer's output sink. Recording
    // redirects that sink to the timeline, so read the live render buffer
    // instead; it is also the source used by screenshots.
    screen: () => decoder.decode((Reflect.get(renderer, "currentRenderBuffer") as RenderBuffer).getRealCharBytes()),
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

export function snapshot(harness: Harness): SimulationProtocol.Frontend.SemanticSnapshot {
  const ids = new Set<string>()
  const visit = (renderable: Renderable, parent?: string): SimulationProtocol.Frontend.SemanticNode[] => {
    if (!renderable.visible || renderable.isDestroyed) return []
    const definition = SimulationSemantics.read(renderable)?.()
    if (definition && ids.has(renderable.id)) throw new Error(`duplicate semantic UI id: ${renderable.id}`)
    if (definition) ids.add(renderable.id)
    const node = definition
      ? [{ id: renderable.id, ...definition, ...(parent === undefined ? {} : { parent }), element: renderable.num }]
      : []
    const ancestor = definition ? renderable.id : parent
    return [...node, ...children(renderable).flatMap((child) => visit(child, ancestor))]
  }
  return Schema.decodeUnknownSync(SimulationProtocol.Frontend.SemanticSnapshot)({
    format: "opencode-ui-snapshot-v1",
    nodes: visit(harness.renderer.root),
  })
}

export function matches(harness: Pick<Harness, "screen">, text: string) {
  return harness.screen().includes(text)
}

export const capture = Effect.fn("SimulationActions.capture")(function* (harness: Harness) {
  yield* Effect.tryPromise(() => harness.renderOnce())
  const buffer = harness.renderer.currentRenderBuffer
  return {
    cols: buffer.width,
    rows: buffer.height,
    cursor: [0, 0] as const,
    lines: buffer.getSpanLines().map((line) => ({
      spans: line.spans.map((span) => ({
        text: span.text,
        fg: span.fg.toInts(),
        bg: span.bg.toInts(),
        attributes: span.attributes,
        width: span.width,
      })),
    })),
  } satisfies SimulationProtocol.Frontend.CapturedFrame
})

export const screenshot = Effect.fn("SimulationActions.screenshot")(function* (harness: Harness, name?: string) {
  const filename = name ?? `screenshot-${crypto.randomUUID()}`
  if (!filename || filename.includes("/") || filename.includes("\\") || extname(filename))
    return yield* Effect.fail(new Error("screenshot name must not contain a path or extension"))
  yield* Effect.tryPromise(() => harness.renderOnce())
  const { SimulationPng } = yield* Effect.promise(() => import("./png"))
  const image = SimulationPng.screenshot(harness.renderer)
  const directory = resolve(
    yield* Config.string("OPENCODE_DRIVE_MEDIA_DIR").pipe(
      Config.withDefault(join(tmpdir(), "opencode-drive", "output")),
    ),
  )
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(directory, { recursive: true })
  const path = join(directory, `${filename}.png`)
  yield* fs.writeFile(path, image.data)
  return path
})

export const execute = Effect.fn("SimulationActions.execute")(function* (harness: Harness, action: Action) {
  switch (action.type) {
    case "ui.type":
      yield* Effect.tryPromise(() => harness.mockInput.typeText(action.text))
      break
    case "ui.press":
      harness.mockInput.pressKey(keyInput(action.key), action.modifiers)
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
    case "ui.click": {
      const target = all(harness.renderer.root).find((item) => item.num === action.target)
      if (!target || !target.visible || target.isDestroyed)
        return yield* Effect.fail(new Error(`click target is stale or unavailable: ${action.target}`))
      if (action.semantic) {
        const current = snapshot(harness).nodes.find((node) => node.element === action.target)
        if (
          current?.id !== action.semantic.id ||
          current.instance !== action.semantic.instance ||
          current.element !== action.semantic.element
        )
          return yield* Effect.fail(new Error(`semantic click target is stale or unavailable: ${action.semantic.id}`))
      }
      if (
        !Number.isFinite(action.x) ||
        action.x < 0 ||
        action.x >= target.width ||
        !Number.isFinite(action.y) ||
        action.y < 0 ||
        action.y >= target.height
      )
        return yield* Effect.fail(new Error("click position must be within the target element"))
      yield* Effect.tryPromise(() => harness.mockMouse.click(target.screenX + action.x, target.screenY + action.y))
      break
    }
    case "ui.resize":
      if (
        !Number.isSafeInteger(action.cols) ||
        action.cols <= 0 ||
        !Number.isSafeInteger(action.rows) ||
        action.rows <= 0
      ) {
        return yield* Effect.fail(new Error("resize cols and rows must be positive integers"))
      }
      harness.resize(action.cols, action.rows)
      SimulationRenderer.recordResize(harness.renderer, action.cols, action.rows)
      break
  }
  yield* Effect.tryPromise(() => harness.renderOnce())
  return state(harness)
})

export * as SimulationActions from "./actions"
