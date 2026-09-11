import { expect, test } from "bun:test"
import { BoxRenderable, TextRenderable } from "@opentui/core"
import { Effect } from "effect"
import { createHarness, execute, type Harness, matches, snapshot, state } from "../src/frontend/actions"
import { SimulationRenderer } from "../src/frontend/renderer"
import { SimulationSemantics } from "../src/frontend/semantics"

test("matches literal screen text", () => {
  const harness = { screen: () => "OpenCode [ready].*" }

  expect(matches(harness, "OpenCode")).toBe(true)
  expect(matches(harness, "[ready].*")).toBe(true)
  expect(matches(harness, "OpenCode.*ready")).toBe(false)
  expect(matches(harness, "opencode")).toBe(false)
})

test("omits an absent focused renderable from state", () => {
  const harness = {
    renderer: {
      root: { getChildren: () => [] },
      currentFocusedRenderable: undefined,
      currentFocusedEditor: undefined,
    },
  } as unknown as Harness

  expect(state(harness)).toEqual({ focused: { editor: false }, elements: [] })
})

test("normalizes named keys for OpenTUI", async () => {
  const pressed: Array<readonly [string, object | undefined]> = []
  const harness = {
    renderer: {
      root: { getChildren: () => [] },
      currentFocusedRenderable: undefined,
      currentFocusedEditor: undefined,
    },
    mockInput: {
      pressKey: (key: string, modifiers?: object) => pressed.push([key, modifiers]),
    },
    renderOnce: async () => {},
  } as unknown as Harness

  await Effect.runPromise(
    execute(harness, {
      type: "ui.press",
      key: "escape",
      modifiers: { ctrl: true },
    }),
  )
  await Effect.runPromise(execute(harness, { type: "ui.press", key: "x" }))

  expect(pressed).toEqual([
    ["ESCAPE", { ctrl: true }],
    ["x", undefined],
  ])
})

test("headless input mirrors the configured kitty keyboard protocol", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({ useKittyKeyboard: {} })
        const harness = createHarness(renderer)
        let key: { readonly name: string; readonly source: string } | undefined
        renderer.keyInput.once("keypress", (event) => {
          key = event
        })

        yield* execute(harness, { type: "ui.press", key: "escape" })

        expect(key).toMatchObject({ name: "escape", source: "kitty" })
      }),
    ),
  )
})

test("clicks a target at relative coordinates through descendant text", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({})
        let clicks = 0
        const button = new BoxRenderable(renderer, {
          id: "permission.action.once",
          width: 12,
          height: 1,
          onMouseUp: () => clicks++,
        })
        button.add(new TextRenderable(renderer, { content: "Allow once" }))
        renderer.root.add(button)
        const harness = createHarness(renderer)
        yield* Effect.promise(() => harness.renderOnce())

        expect(state(harness).elements).toContainEqual(expect.objectContaining({ id: button.id, clickable: true }))
        yield* execute(harness, { type: "ui.click", target: button.num, x: 1, y: 0 })
        expect(clicks).toBe(1)

        renderer.root.remove(button)
        const error = yield* execute(harness, { type: "ui.click", target: button.num, x: 1, y: 0 }).pipe(Effect.flip)
        expect(error.message).toContain("click target is stale or unavailable")
      }),
    ),
  )
})

test("unpaced clicks preserve native event order, button release and rendered state", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({})
        const events: string[] = []
        const label = new TextRenderable(renderer, { content: "Not clicked" })
        let clicks = 0
        const button = new BoxRenderable(renderer, {
          id: "click-order",
          width: 20,
          height: 1,
          onMouseDown: () => {
            events.push("down")
            queueMicrotask(() => events.push("down microtask"))
          },
          onMouseUp: () => {
            events.push("up")
            label.content = `Clicks: ${++clicks}`
          },
        })
        button.add(label)
        renderer.root.add(button)
        const harness = createHarness(renderer)
        yield* Effect.promise(() => harness.renderOnce())

        for (let index = 0; index < 5; index++) {
          const result = yield* execute(harness, { type: "ui.click", target: button.num, x: 1, y: 0 })
          expect(clicks).toBe(index + 1)
          expect(events.splice(0)).toEqual(["down", "down microtask", "up"])
          expect(harness.mockMouse.getPressedButtons()).toEqual([])
          expect(harness.screen()).toContain(`Clicks: ${index + 1}`)
          expect(result).toEqual(state(harness))
        }
      }),
    ),
  )
})

test("unpaced clicks retain native double-click text selection", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({})
        const text = new TextRenderable(renderer, { content: "alpha beta", selectable: true })
        renderer.root.add(text)
        const harness = createHarness(renderer)
        yield* Effect.promise(() => harness.renderOnce())

        yield* execute(harness, { type: "ui.click", target: text.num, x: 1, y: 0 })
        yield* execute(harness, { type: "ui.click", target: text.num, x: 1, y: 0 })
        expect(renderer.getSelection()?.getSelectedText()).toBe("alpha")
        expect(harness.mockMouse.getPressedButtons()).toEqual([])
      }),
    ),
  )
})

test("mouse input drives native hover, drag, buttons and scrolling at absolute coordinates", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({})
        const events: Array<{ type: string; x: number; y: number; button: number }> = []
        const button = new BoxRenderable(renderer, {
          position: "absolute",
          left: 10,
          top: 5,
          width: 15,
          height: 3,
          onMouse: (event) => events.push({ type: event.type, x: event.x, y: event.y, button: event.button }),
        })
        renderer.root.add(button)
        const harness = createHarness(renderer)
        yield* Effect.promise(() => harness.renderOnce())
        yield* execute(harness, { type: "ui.mouse", params: { action: "move", x: 11, y: 6 } })
        yield* execute(harness, { type: "ui.mouse", params: { action: "move", x: 12, y: 6 } })
        expect(events.map((event) => event.type)).toContain("over")
        expect(events).toContainEqual(expect.objectContaining({ type: "move", x: 12, y: 6 }))
        yield* execute(harness, { type: "ui.mouse", params: { action: "down", x: 12, y: 6, button: "right" } })
        yield* execute(harness, { type: "ui.mouse", params: { action: "move", x: 13, y: 6 } })
        yield* execute(harness, { type: "ui.mouse", params: { action: "up", x: 13, y: 6, button: "right" } })
        expect(events).toContainEqual(expect.objectContaining({ type: "down", button: 2 }))
        expect(events).toContainEqual(expect.objectContaining({ type: "drag", x: 13, y: 6 }))
        expect(events).toContainEqual(expect.objectContaining({ type: "up", x: 13, y: 6, button: 2 }))
        expect(harness.mockMouse.getPressedButtons()).toEqual([])
        yield* execute(harness, { type: "ui.mouse", params: { action: "scroll", x: 12, y: 6, direction: "down" } })
        expect(events.map((event) => event.type)).toContain("scroll")
        yield* execute(harness, { type: "ui.mouse", params: { action: "move", x: 1, y: 1 } })
        expect(events.map((event) => event.type)).toContain("out")
        const error = yield* execute(harness, { type: "ui.mouse", params: { action: "move", x: 100, y: 40 } }).pipe(
          Effect.flip,
        )
        expect(error.message).toContain("within the terminal viewport")
      }),
    ),
  )
})

test("rejects a semantic click when the live identity does not match", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({})
        let clicks = 0
        const button = new BoxRenderable(renderer, {
          id: "session.permission.action.once",
          width: 12,
          height: 1,
          onMouseUp: () => clicks++,
        })
        SimulationSemantics.bind(() => ({
          instance: "permission-2",
          role: "option",
          label: "Allow once",
        }))(button)
        renderer.root.add(button)
        const harness = createHarness(renderer)
        yield* Effect.promise(() => harness.renderOnce())

        const error = yield* execute(harness, {
          type: "ui.click",
          target: button.num,
          x: 1,
          y: 0,
          semantic: {
            id: "session.permission.action.once",
            instance: "permission-1",
            element: button.num,
          },
        }).pipe(Effect.flip)
        expect(error.message).toContain("semantic click target is stale or unavailable")
        expect(clicks).toBe(0)

        yield* execute(harness, {
          type: "ui.click",
          target: button.num,
          x: 1,
          y: 0,
          semantic: {
            id: "session.permission.action.once",
            instance: "permission-2",
            element: button.num,
          },
        })
        expect(clicks).toBe(1)
      }),
    ),
  )
})

test("snapshots lazy semantic hierarchy and interaction state", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({})
        let selected = "once"
        const dialog = new BoxRenderable(renderer, { id: "session.permission" })
        const actions = new BoxRenderable(renderer, { id: "session.permission.actions" })
        const once = new BoxRenderable(renderer, { id: "session.permission.action.once" })
        SimulationSemantics.bind(() => ({
          instance: "permission-1",
          role: "dialog",
          label: "Permission required",
          expanded: false,
        }))(dialog)
        SimulationSemantics.bind(() => ({
          instance: "permission-1",
          role: "listbox",
          label: "Permission choices",
        }))(actions)
        SimulationSemantics.bind(() => ({
          instance: "permission-1",
          role: "option",
          label: "Allow once",
          focused: selected === "once",
          selected: selected === "once",
          disabled: false,
        }))(once)
        renderer.root.add(dialog)
        dialog.add(actions)
        actions.add(once)

        expect(snapshot(createHarness(renderer))).toEqual({
          format: "opencode-ui-snapshot-v1",
          nodes: [
            {
              id: "session.permission",
              instance: "permission-1",
              role: "dialog",
              label: "Permission required",
              element: dialog.num,
              expanded: false,
            },
            {
              id: "session.permission.actions",
              instance: "permission-1",
              parent: "session.permission",
              role: "listbox",
              label: "Permission choices",
              element: actions.num,
            },
            {
              id: "session.permission.action.once",
              instance: "permission-1",
              parent: "session.permission.actions",
              role: "option",
              label: "Allow once",
              element: once.num,
              focused: true,
              selected: true,
              disabled: false,
            },
          ],
        })

        selected = "reject"
        expect(snapshot(createHarness(renderer)).nodes.at(-1)).toMatchObject({
          id: "session.permission.action.once",
          focused: false,
          selected: false,
        })
        dialog.visible = false
        expect(snapshot(createHarness(renderer)).nodes).toEqual([])
      }),
    ),
  )
})

test("rejects duplicate semantic identities", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({})
        const first = new BoxRenderable(renderer, { id: "duplicate" })
        const second = new BoxRenderable(renderer, { id: "duplicate" })
        const definition = () => ({ role: "option" })
        SimulationSemantics.bind(definition)(first)
        SimulationSemantics.bind(definition)(second)
        renderer.root.add(first)
        renderer.root.add(second)

        expect(() => snapshot(createHarness(renderer))).toThrow("duplicate semantic UI id: duplicate")
      }),
    ),
  )
})

test("validates lazy semantic definitions before returning them", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({})
        const invalid = new BoxRenderable(renderer, { id: "invalid" })
        SimulationSemantics.bind(() => ({ role: "" }))(invalid)
        renderer.root.add(invalid)

        expect(() => snapshot(createHarness(renderer))).toThrow()
      }),
    ),
  )
})
