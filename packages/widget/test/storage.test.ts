import { expect, test } from "bun:test"
import { type LiveOptions, LiveWidget, ManualClock, type Node, program } from "../src/index.js"
import { LIVE } from "./limits.js"

// A weight and calorie tracker: one key per entry, so writes from two devices never overwrite each other.
const tracker = `
async function main(data) {
  let n = 0
  const heard = []
  const view = () => {
    const entries = widget.storage.keys("entry:").map((key) => widget.storage.get(key))
    const kcal = entries.reduce((sum, entry) => sum + (entry.kcal ?? 0), 0)
    const weights = entries.filter((entry) => entry.kg !== undefined)
    const kg = weights.length ? weights[weights.length - 1].kg : "-"
    widget.render(
      ui.column([
        ui.text(kcal + " kcal | " + kg + " kg | " + entries.length),
        ui.button("Meal", { onPress: () => log({ kcal: 500 }) }),
        ui.button("Weigh", { onPress: () => log({ kg: 79.5 }) }),
        ui.text(heard.join(",")),
        ui.button("Undo", {
          onPress: async () => {
            const last = widget.storage.keys("entry:").at(-1)
            if (last) await widget.storage.delete(last)
            view()
          },
        }),
      ]),
    )
  }
  const log = async (entry) => {
    await widget.storage.set("entry:" + data.device + ":" + n++, entry)
    view()
  }
  widget.on("storage", (change) => {
    heard.push(change.key)
    view()
  })
  view()
}
`

// The server's space and each app's glue: a write goes to the space, and the space sends every change to each running
// widget of the template, its writer's included, in order.
const space = () => {
  const values = new Map<string, string>()
  const widgets: LiveWidget[] = []
  return {
    values,
    start: (source: string, data: Record<string, unknown>, options: LiveOptions = {}) => {
      const widget = LiveWidget.start(program(source, "live"), data, {
        clock: new ManualClock(),
        ...LIVE,
        storage: { entries: [...values].map(([key, value]) => ({ key, value })) },
        onMessage: (message) => {
          if (message.type !== "storage") return
          if (message.value === undefined) values.delete(message.key)
          else values.set(message.key, message.value)
          queueMicrotask(() => widgets.forEach((each) => each.storage(message.key, message.value)))
        },
        ...options,
      })
      widgets.push(widget)
      return widget
    },
  }
}

const children = (widget: LiveWidget) => {
  const view = widget.view
  return view && "children" in view ? (view.children as Node[]) : []
}
const text = (widget: LiveWidget) => {
  const first = children(widget)[0]
  return first?.type === "text" ? first.text : undefined
}
const heard = (widget: LiveWidget) => {
  const node = children(widget)[3]
  return node?.type === "text" ? node.text : undefined
}
const press = (widget: LiveWidget, label: string) => {
  const node = children(widget).find((child) => "label" in child && child.label === label)
  if (!node || !("id" in node)) throw new Error("no button " + label)
  widget.event({ id: node.id as string, type: "press" })
}
const showing = (widget: LiveWidget, expected: string) => widget.when((current) => text(current) === expected)
const failed = async (widget: LiveWidget) => {
  const end = await widget.done
  if (end.type !== "error") throw new Error("the run ended with " + end.type)
  return end.error.message
}

test("two devices share a tracker's entries, and a re-show starts from the synced copy", async () => {
  const shared = space()
  const a = shared.start(tracker, { device: "phone" })
  const b = shared.start(tracker, { device: "desktop" })
  await showing(a, "0 kcal | - kg | 0")

  press(a, "Meal")
  await showing(b, "500 kcal | - kg | 1")
  press(b, "Weigh")
  press(b, "Meal")
  await showing(a, "1000 kcal | 79.5 kg | 3")
  expect(shared.values.size).toBe(3)
  expect(shared.values.get("entry:phone:0")).toBe('{"kcal":500}')

  press(a, "Undo")
  await showing(b, "500 kcal | 79.5 kg | 2")
  // Each widget hears only the changes from elsewhere: its own writes coming back change nothing.
  expect(heard(a)).toBe("entry:desktop:0,entry:desktop:1")
  expect(heard(b)).toBe("entry:phone:0,entry:phone:0")

  const again = shared.start(tracker, { device: "tablet" })
  await showing(again, "500 kcal | 79.5 kg | 2")
  await Promise.all([a.stop(), b.stop(), again.stop()])
})

const run = (source: string, options: LiveOptions) =>
  LiveWidget.start(program(source, "live"), {}, { clock: new ManualClock(), ...LIVE, ...options })

test("a client without storage, or a widget template without the capability, fails at the first use", async () => {
  const source = `async function main() {\n  widget.storage.get("goal")\n}`
  expect(await failed(run(source, {}))).toContain(
    "Unsupported: widget.storage: storage needs a client with spaces sync (OpenCode desktop or Android)",
  )
  expect(await failed(run(source, { storage: null }))).toContain(
    "CapabilityDenied: widget.storage: storage is not declared: save the widget template with capabilities: { storage: {} }",
  )
})

test("errors carry a kind, and a program can catch them", async () => {
  const source = `async function main() {
    try { await widget.storage.set("a", 1) } catch (error) { widget.render(ui.text(error.kind)) }
  }`
  const widget = run(source, {})
  await widget.when((current) => current.view?.type === "text" && current.view.text === "Unsupported")
})

test("the limits: key length, value size, key count and total size", async () => {
  const check = async (body: string, expected: string, entries: { key: string; value: string }[] = []) => {
    const widget = run(`async function main() {\n  ${body}\n}`, { storage: { entries } })
    expect(await failed(widget)).toContain(expected)
  }
  await check(
    `await widget.storage.set("k".repeat(257), 1)`,
    "TooLarge: widget.storage: a key is longer than 256 characters",
  )
  await check(`await widget.storage.set("", 1)`, "widget.storage.set needs a key that is a non-empty string")
  await check(
    `await widget.storage.set("big", "é".repeat(40000))`,
    "TooLarge: widget.storage: a value is over 64 KiB of JSON",
  )
  const full = Array.from({ length: 1000 }, (_, index) => ({ key: "k" + index, value: "1" }))
  await check(
    `await widget.storage.set("one-more", 1)`,
    "TooLarge: widget.storage: storage holds 1000 keys already",
    full,
  )
  const heavy = Array.from({ length: 17 }, (_, index) => ({
    key: "k" + index,
    value: JSON.stringify("x".repeat(62000)),
  }))
  await check(
    `await widget.storage.set("last", "x".repeat(60000))`,
    "TooLarge: widget.storage: storage would hold over 1 MiB",
    heavy,
  )
})

test("a program that posts around the prelude fails like an invalid post", async () => {
  const widget = run(`async function main() {\n  __host.post({ type: "storage", key: "a", value: 1 })\n}`, {
    storage: { entries: [] },
  })
  expect(await failed(widget)).toBe("A storage post's value must be JSON text of at most 64 KiB")
})

test("values that aren't JSON text read as strings, and a delete reads as undefined", async () => {
  const widget = run(
    `async function main() {
      widget.on("storage", (change) => widget.render(ui.text(JSON.stringify([change, widget.storage.get(change.key) ?? "gone"]))))
      widget.render(ui.text(String(widget.storage.get("raw")) + " " + widget.storage.keys().join(",")))
    }`,
    {
      storage: {
        entries: [
          { key: "raw", value: "not json" },
          { key: "goal", value: '{"kcal":2000}' },
        ],
      },
    },
  )
  await widget.when((current) => current.view?.type === "text" && current.view.text === "not json goal,raw")
  widget.storage("goal")
  await widget.when(
    (current) => current.view?.type === "text" && current.view.text === '[{"key":"goal","value":null},"gone"]',
  )
  await widget.stop()
})

test("the weight tracker logs from inputs and charts the history: live changes, reading a day, the range", async () => {
  const source = await Bun.file(new URL("./fixtures/weight-tracker.js", import.meta.url)).text()
  const day = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString()
  const entry = (ago: number, value: Record<string, number>) => ({
    key: "entry:" + day(ago) + ":" + Object.keys(value)[0],
    value: JSON.stringify({ at: day(ago), ...value }),
  })
  // The real clock: a render and a draw per change, past the post rate's burst, wait for its tokens.
  const widget = LiveWidget.start(
    program(source, "live"),
    { title: "Tracker" },
    {
      ...LIVE,
      storage: {
        entries: [entry(2, { kg: 80 }), entry(2, { kcal: 1800 }), entry(1, { kg: 79.6 }), entry(1, { kcal: 2100 })],
      },
    },
  )
  const all = (node: Node | undefined): Node[] =>
    node ? [node, ...("children" in node ? (node.children as Node[]).flatMap(all) : [])] : []
  const find = (test: (node: Node) => boolean) => all(widget.view).find(test)
  const texts = () => all(widget.view).flatMap((node) => (node.type === "text" ? [node.text] : []))
  const summary = () => texts().find((text) => text.startsWith("Today "))
  const caption = () =>
    texts().find((text) => text.includes("chart to read a day") || /^[A-Z][a-z]{2} \d+: /.test(text))
  const id = (test: (node: Node) => boolean) => (find(test) as { id: string }).id
  const button = (label: string) => id((node) => node.type === "button" && node.label === label)
  const chart = () => [...widget.drawings.values()][0] ?? []
  const count = (kind: string) => chart().filter((command) => command[0] === kind).length
  // The intro asks for frames until it has drawn the chart in.
  const intro = async () => {
    const size = { t: 0, dt: 1 / 60, width: 360, height: 600, scale: 2, pointer: null, dark: false }
    for (let frames = 0; frames < 200; frames++) {
      await widget.when((current) => current.frameRequested).catch(() => undefined)
      if (!widget.frame(size)) break
      await Bun.sleep(5)
      if (!widget.frameRequested && frames > 0) {
        await Bun.sleep(30)
        if (!widget.frameRequested) break
      }
    }
  }
  await intro()
  // Two days of calories as bars, two weights on the line, and the legend's two dots.
  await widget.when(() => count("path") === 1 && count("rrect") === 2)
  expect(count("circle")).toBe(4)
  expect(summary()).toBe("Today 0 kcal · 79.6 kg · 4 entries")

  // A meal logged on another device arrives through on("storage"): the summary and the bars follow.
  widget.storage("entry:" + day(0) + ":phone", JSON.stringify({ at: day(0), kcal: 600 }))
  await widget.when(() => summary() === "Today 600 kcal · 79.6 kg · 5 entries" && count("rrect") === 3)

  // Logging from the input: a number is stored as an entry; anything else asks for one.
  const kcal = () => id((node) => node.type === "input" && node.placeholder === "Calories (kcal)")
  widget.event({ id: kcal(), type: "change", value: "abc" })
  widget.event({ id: button("Log meal"), type: "press" })
  await widget.when(() => texts().includes("Enter calories from 1 to 9999 kcal"))
  widget.event({ id: kcal(), type: "change", value: "450" })
  widget.event({ id: button("Log meal"), type: "press" })
  await widget.when(() => summary() === "Today 1050 kcal · 79.6 kg · 6 entries")
  expect(texts()).toContain("Logged 450 kcal")
  // Typing doesn't render; after an entry the input is a new, empty one.
  const before = kcal()
  widget.event({ id: before, type: "change", value: "12" })
  await Bun.sleep(50)
  expect(kcal()).toBe(before)
  expect(
    (find((node) => node.type === "input" && node.placeholder === "Calories (kcal)") as { value: string }).value,
  ).toBe("")

  // Press the last day, then drag to the one before: the caption and the tooltip show the day under the pointer.
  const canvas = id((node) => node.type === "canvas")
  const pointer = (kind: "down" | "move" | "up", x: number) =>
    widget.event({ id: canvas, type: "pointer", value: { kind, x, y: 120, width: 360, height: 240 } })
  pointer("down", 300)
  await widget.when(() => caption()?.endsWith(": 1050 kcal") === true)
  pointer("move", 250)
  await widget.when(() => caption()?.endsWith(": 2100 kcal · 79.6 kg") === true)
  pointer("up", 250)
  await widget.when(() => chart().some((command) => command[0] === "text" && command[3] === "2100 kcal"))

  // The last 30 days: the pick is cleared and the chart animates in again.
  widget.event({ id: id((node) => node.type === "select"), type: "change", value: "month" })
  await widget.when(() => caption() === "Press or drag the chart to read a day")
  await intro()
  const alt = find((node) => node.type === "canvas") as { alt: string }
  expect(alt.alt.startsWith("Chart of the last 30 days.")).toBe(true)
  await widget.stop()
})
