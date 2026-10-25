/** @jsxImportSource @opentui/solid */
import { testRender, useKeyboard } from "@opentui/solid"
import { expect, test } from "bun:test"
import { keypadKeyName } from "../src/util/keypad"

test("keypad navigation keys resolve to their regular names", () => {
  expect(
    ["kpup", "kpdown", "kpleft", "kpright", "kppageup", "kppagedown", "kphome", "kpend"].map(keypadKeyName),
  ).toEqual(["up", "down", "left", "right", "pageup", "pagedown", "home", "end"])
})

test("regular names and unrelated keys pass through unchanged", () => {
  for (const name of ["up", "down", "left", "right", "pageup", "pagedown", "home", "end", "escape", "return", "kp0"])
    expect(keypadKeyName(name)).toBe(name)
})

test("a keypad key satisfies a handler that compares regular key names", async () => {
  // Mirrors the guard the error screen, the error details dialog, the /btw answer, the file
  // changes dialog and the mini footers use: a comparison against the regular key name.
  const fired: string[] = []
  let wake = () => {}

  function Harness() {
    useKeyboard((event) => {
      if (keypadKeyName(event.name) !== "end") return
      fired.push(event.name)
      wake()
    })
    return <box />
  }

  const app = await testRender(() => <Harness />)
  // Waits for the handler rather than sleeping a fixed interval, so a slow machine cannot
  // turn this into a failure.
  const settled = (count: number) =>
    new Promise<void>((resolve) => {
      wake = () => {
        if (fired.length >= count) resolve()
      }
      if (fired.length >= count) resolve()
    })

  try {
    // Kitty keyboard protocol: keypad End reports codepoint 57424.
    const keypad = settled(1)
    app.renderer.stdin.emit("data", Buffer.from("\x1b[57424;1:1u"))
    await keypad
    expect(fired).toEqual(["kpend"])

    // The regular End key keeps working.
    const regular = settled(2)
    app.renderer.stdin.emit("data", Buffer.from("\x1b[4~"))
    await regular
    expect(fired).toEqual(["kpend", "end"])
  } finally {
    app.renderer.destroy()
  }
})
