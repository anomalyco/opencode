import { expect, test } from "bun:test"
import { Effect } from "effect"
import { execute, type Harness, matches } from "../src/frontend/actions"

test("matches literal screen text", () => {
  const harness = { screen: () => "OpenCode [ready].*" }

  expect(matches(harness, "OpenCode")).toBe(true)
  expect(matches(harness, "[ready].*")).toBe(true)
  expect(matches(harness, "OpenCode.*ready")).toBe(false)
  expect(matches(harness, "opencode")).toBe(false)
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
