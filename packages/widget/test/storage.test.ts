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
