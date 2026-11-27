import { expect, test } from "bun:test"
import { type Command, type LiveFrame, LiveWidget, ManualClock, type Node, program } from "../src/index.js"
import { LIVE } from "./limits.js"

// A complete live game (not a built-in), run on the reference live host: frames, a canvas handler, timers, pausing.
const source = await Bun.file(new URL("./fixtures/tap-dots.js", import.meta.url)).text()
const WIDTH = 360
const HEIGHT = 320
// The canvas's id: the prelude derives it from the canvas's `key`.
const BOARD = "0/:board"

const play = (data: unknown) => {
  const clock = new ManualClock()
  const widget = LiveWidget.start(program(source, "live"), data, { clock, ...LIVE })
  const time = { t: 0 }
  // One display frame 16 ms after the last, once the program asks for it; resolves once it is drawn.
  const frame = async () => {
    await widget.when((current) => current.frameRequested)
    await clock.advance(16)
    time.t += 0.016
    const next: LiveFrame = { t: time.t, dt: 0.016, width: WIDTH, height: HEIGHT, scale: 2, pointer: null, dark: true }
    const before = widget.drawings.get(BOARD)
    expect(widget.frame(next)).toBe(true)
    await widget.when((current) => current.drawings.get(BOARD) !== before || buttons(current.view).length > 0)
  }
  const tap = (x: number, y: number) =>
    widget.event({ id: BOARD, type: "pointer", value: { kind: "down", x, y, width: WIDTH, height: HEIGHT } })
  return { widget, clock, frame, tap }
}

const board = (widget: LiveWidget) => widget.drawings.get(BOARD) ?? []
const texts = (commands: ReadonlyArray<Command>) =>
  commands.flatMap((command) => (command[0] === "text" ? [command[3]] : []))
// The filled circles: the live dots (each also has a faint ring at its full size).
const dots = (commands: ReadonlyArray<Command>) =>
  commands.flatMap((command) =>
    command[0] === "circle" && typeof command[4].fill === "string"
      ? [{ x: command[1], y: command[2], r: command[3] }]
      : [],
  )
const all = (node: Node | undefined): Node[] =>
  node ? [node, ...("children" in node ? node.children.flatMap(all) : [])] : []
const buttons = (view: Node | undefined) => all(view).flatMap((node) => (node.type === "button" ? [node.label] : []))
const button = (view: Node | undefined, label: string) =>
  all(view).flatMap((node) => (node.type === "button" && node.label === label ? [node.id] : []))[0] ?? ""

test("tap the dots: tap to start, tap shrinking dots to score, then submit the score", async () => {
  const game = play({ title: "Tap the dots", seconds: 5 })
  await game.frame()
  expect(all(game.widget.view).map((node) => node.type)).toEqual(["column", "text", "canvas", "text"])
  expect(texts(board(game.widget))).toEqual(["Tap to start", "5 seconds · smaller dots score more"])

  game.tap(10, 10)
  await game.frame()
  expect(texts(board(game.widget))).toEqual(["0", "5s"])

  // Play until time runs out, tapping the first dot every few frames once it has shrunk a little.
  const taps = { count: 0 }
  for (let frame = 0; buttons(game.widget.view).length === 0; frame++) {
    const target = dots(board(game.widget)).find((dot) => dot.r < 30)
    if (target && frame % 6 === 0) {
      game.tap(target.x, target.y)
      taps.count++
    }
    await game.frame()
    // Frames stop at the result screen; give up well after the 5 s round.
    expect(frame).toBeLessThan(400)
  }
  const commands = board(game.widget)
  expect(commands.length).toBeLessThan(60)
  expect(taps.count).toBeGreaterThan(5)
  const score = Number(
    all(game.widget.view)
      .flatMap((node) => (node.type === "text" && node.text.endsWith("points") ? [node.text] : []))[0]
      ?.split(" ")[0],
  )
  expect(score).toBeGreaterThanOrEqual(taps.count)
  expect(buttons(game.widget.view)).toEqual(["Submit score", "Play again"])
  game.widget.event({ id: button(game.widget.view, "Submit score"), type: "press" })
  expect(await game.widget.done).toEqual({ type: "submit", value: { score, seconds: 5 } })
})

test("tap the dots: a miss scores nothing, the round ends on time even without frames, and it can be played again", async () => {
  const game = play({ title: "Dots" })
  await game.frame()
  game.tap(5, 5)
  await game.frame()
  for (let frame = 0; frame < 40; frame++) await game.frame()
  game.tap(1, HEIGHT - 1)
  await game.frame()
  expect(texts(board(game.widget))[0]).toBe("0")
  // Frames stop (the widget left the screen without pausing); the 20 s round still ends on its timer.
  await game.clock.advance(20_000)
  await game.widget.when((current) => buttons(current.view).length > 0)
  expect(all(game.widget.view).some((node) => node.type === "text" && node.text === "0 points")).toBe(true)
  game.widget.event({ id: button(game.widget.view, "Play again"), type: "press" })
  await game.frame()
  expect(texts(board(game.widget))[0]).toBe("Tap to start")
  await game.widget.stop()
})

test("tap the dots: pausing freezes the clock", async () => {
  const game = play({ title: "Dots", seconds: 10 })
  await game.frame()
  game.tap(5, 5)
  await game.frame()
  game.widget.pause()
  await game.clock.advance(60_000)
  game.widget.resume()
  await game.frame()
  expect(texts(board(game.widget))).toContain("10s")
  await game.widget.stop()
})
