import { expect, test } from "bun:test"
import {
  type FetchRequest,
  type LiveFrame,
  type LiveMessage,
  type LiveOptions,
  LiveWidget,
  ManualClock,
  type Node,
  program,
  type Transport,
} from "../src/index.js"
import { LIVE } from "./limits.js"

const size: LiveFrame = { t: 0, dt: 1 / 60, width: 300, height: 200, scale: 2, pointer: null, dark: true }
const press = (id: string) => ({ id, type: "press" as const })

const histories = new WeakMap<LiveWidget, LiveMessage[]>()

const start = (source: string, options: LiveOptions = {}, data: unknown = {}) => {
  const clock = new ManualClock()
  const messages: LiveMessage[] = []
  const widget = LiveWidget.start(program(source, "live"), data, {
    clock,
    ...LIVE,
    onMessage: (message) => messages.push(message),
    ...options,
  })
  histories.set(widget, messages)
  return { widget, clock, messages }
}

// The text of the last rendered view, for programs that report what they saw with `ui.text(...)`.
const shown = (widget: LiveWidget) => (widget.view?.type === "text" ? widget.view.text : undefined)
// Resolves once the program has rendered `ui.text(text)`, even if it rendered something else since.
const showing = (widget: LiveWidget, text: string) =>
  widget.when(() =>
    (histories.get(widget) ?? []).some(
      (message) => message.type === "render" && message.node.type === "text" && message.node.text === text,
    ),
  )

// The id the prelude gave the first node of `type` (optionally with this label) in the last rendered view.
const idOf = (widget: LiveWidget, type: string, label?: string) => {
  const visit = (node: Node): string | undefined => {
    if (node.type === type && (label === undefined || ("label" in node && node.label === label)) && "id" in node)
      return node.id
    return "children" in node ? node.children.map(visit).find((id) => id !== undefined) : undefined
  }
  const id = widget.view && visit(widget.view)
  if (id === undefined) throw new Error(`no ${type} ${label ?? ""}`)
  return id
}
const key = (code: string, kind: "down" | "up" = "down") => ({
  id: "",
  type: "key" as const,
  value: { kind, key: code, code, repeat: false, shift: false, alt: false, ctrl: false, meta: false },
})

test("render, draw by canvas key, handlers and submit", async () => {
  const { widget, messages } = start(
    `
    async function main(data) {
      widget.render(ui.column([
        ui.text(data.title),
        ui.button("Go", { onPress: () => { widget.send({ got: "go" }, { wake: false }); widget.submit({ done: true }) } }),
        ui.canvas({ key: "c", height: 10 }),
      ]))
      widget.draw("c", ui.draw().circle(1, 2, 3))
    }
  `,
    {},
    { title: "Hi" },
  )
  await widget.when((current) => current.drawings.size > 0)
  expect(widget.view).toEqual({
    type: "column",
    children: [
      { type: "text", text: "Hi" },
      { type: "button", id: "0/1", label: "Go" },
      { type: "canvas", id: "0/:c", height: 10 },
    ],
  })
  expect(widget.drawings.get("0/:c")).toEqual([["circle", 1, 2, 3, { fill: "text" }]])
  // main has returned; the view's handler keeps the widget open.
  expect(widget.ended).toBeUndefined()
  widget.event(press("0/1"))
  expect(await widget.done).toEqual({ type: "submit", value: { done: true } })
  expect(messages.map((message) => message.type)).toEqual(["render", "draw", "send", "submit"])
  expect(messages[2]).toEqual({ type: "send", value: { got: "go" }, wake: false })
})

test("handlers get typed values; events for other nodes, of the wrong type or with bad values are dropped", async () => {
  const { widget } = start(`
    async function main() {
      const seen = []
      const show = () =>
        widget.render(ui.column([
          ui.text(seen.join(" ")),
          ui.checkbox("On", false, { onChange: (on) => { seen.push("check:" + on); show() } }),
          ui.slider({ value: 1, min: 0, max: 10, onChange: (value) => { seen.push("slide:" + value); show() } }),
          ui.select(["a", "b"], { onChange: (value) => { seen.push("pick:" + value); show() } }),
          ui.input("", { onChange: (text) => { seen.push("type:" + text); show() } }),
          ui.button("Done", { onPress: () => widget.submit(seen) }),
        ]))
      show()
    }
  `)
  await widget.when((current) => current.view !== undefined)
  const change = (type: string, value: unknown) => widget.event({ id: idOf(widget, type), type: "change", value })
  change("checkbox", true)
  change("checkbox", "yes")
  change("slider", 99)
  change("slider", "x")
  change("select", "b")
  change("select", "zzz")
  change("input", "hi")
  widget.event({ id: idOf(widget, "checkbox"), type: "press" })
  widget.event({ id: "0/404", type: "press" })
  widget.event({ id: idOf(widget, "button"), type: "change", value: 1 })
  widget.event(press(idOf(widget, "button")))
  expect(await widget.done).toEqual({ type: "submit", value: ["check:true", "slide:10", "pick:b", "type:hi"] })
})

test("system events go only to widget.on hooks, control events only to handlers", async () => {
  const { widget, messages } = start(`
    async function main() {
      const seen = []
      widget.capturePointer()
      widget.on("focus", (on) => seen.push("focus:" + on))
      widget.on("capture", (on) => seen.push("capture:" + on))
      widget.on("fullscreen", (on, close) => seen.push("fullscreen:" + on + ":" + (close && close.width)))
      const off = widget.on("key", (key) => seen.push("key:" + key.code + ":" + [...widget.keys].join("+")))
      widget.render(ui.column([
        ui.canvas({
          wgsl: "fn shade(p: vec2f) -> vec4f { return vec4f(1.0); }",
          height: 10,
          onPointer: (p) => seen.push("pointer:" + JSON.stringify(p)),
        }),
        ui.button("Off", { onPress: () => { off(); seen.push("press") } }),
        ui.button("Done", { onPress: () => { widget.releasePointer(); widget.submit({ seen, pointer: widget.pointer }) } }),
      ]))
    }
  `)
  await widget.when((current) => current.view !== undefined)
  const shader = idOf(widget, "canvas")
  const button = idOf(widget, "button")
  widget.event({ id: button, type: "focus", value: true })
  widget.event({ id: "", type: "capture", value: true })
  widget.event({ id: "", type: "fullscreen", value: true, close: { x: 300, y: 8, width: 44, height: 44 } })
  widget.event({ id: shader, type: "pointer", value: { kind: "move", dx: 3, dy: -2 } })
  // A wheel reaches the handler but leaves `widget.pointer` as the last move.
  widget.event({ id: shader, type: "pointer", value: { kind: "wheel", dx: 0, dy: 40 } })
  widget.event(key("KeyA"))
  widget.event(key("KeyB"))
  widget.event({ id: button, type: "key", value: key("KeyC").value })
  widget.event({ id: "", type: "press" })
  widget.event({ id: shader, type: "press" })
  widget.event(press(button))
  widget.event(key("KeyD"))
  widget.event(press(idOf(widget, "button", "Done")))
  expect(await widget.done).toEqual({
    type: "submit",
    value: {
      seen: [
        "focus:true",
        "capture:true",
        "fullscreen:true:44",
        'pointer:{"kind":"move","dx":3,"dy":-2,"button":0}',
        'pointer:{"kind":"wheel","dx":0,"dy":40}',
        "key:KeyA:KeyA",
        "key:KeyB:KeyA+KeyB",
        "key:KeyC:KeyA+KeyB+KeyC",
        "press",
      ],
      pointer: { kind: "move", dx: 3, dy: -2, button: 0 },
    },
  })
  expect(messages.filter((message) => message.type === "capture")).toEqual([
    { type: "capture", value: true },
    { type: "capture", value: false },
  ])
})

test("frames are requested once; handlers run while main awaits a frame", async () => {
  const { widget, messages } = start(`
    async function main() {
      let pressed = "none"
      widget.render(ui.button("Early", { onPress: () => (pressed = "early") }))
      const frame = await widget.frame()
      widget.render(ui.text(frame.width + " " + pressed))
      await widget.sleep(1)
      widget.dismiss()
    }
  `)
  await widget.when((current) => current.frameRequested)
  widget.event(press("0"))
  await Bun.sleep(5)
  expect(widget.frame(size)).toBe(true)
  expect(widget.frame(size)).toBe(false)
  await showing(widget, "300 early")
  expect(messages.filter((message) => message.type === "frame")).toHaveLength(1)
})

test("a paused program gets nothing until it resumes, then hears how long it was paused", async () => {
  const { widget, clock } = start(`
    async function main() {
      const before = widget.now()
      let resumed = null
      let pressed = null
      widget.on("resumed", (ms) => (resumed = ms))
      widget.render(ui.button("Held", { onPress: () => (pressed = widget.now()) }))
      await widget.sleep(1000)
      widget.render(ui.text("slept " + (widget.now() - before) + " resumed " + resumed + " pressed at " + pressed))
      await widget.sleep(1e9)
    }
  `)
  await widget.when((current) => current.view !== undefined)
  await clock.advance(400)
  widget.pause()
  expect(widget.paused).toBe(true)
  await clock.advance(5000)
  widget.event(press("0"))
  widget.resume()
  await clock.advance(599)
  expect(shown(widget)).toBeUndefined()
  await clock.advance(1)
  await showing(widget, "slept 1000 resumed 5000 pressed at 400")
  await widget.stop()
})

test("a program that throws, renders an invalid view, draws too much or fails in a handler stops with an error", async () => {
  const failure = async (body: string, after?: (widget: LiveWidget) => void) => {
    const { widget } = start(`async function main() { ${body} }`)
    if (after) {
      await widget.when((current) => current.view !== undefined)
      after(widget)
    }
    const end = await widget.done
    return end.type === "error" ? { kind: end.error.kind, message: end.error.message } : end
  }
  expect(await failure(`throw new Error("boom")`)).toMatchObject({ kind: "error", message: "Error: boom" })
  expect(await failure(`widget.render({ type: "button" })`)).toMatchObject({ kind: "invalid" })
  expect(
    await failure(`widget.render(ui.canvas({ key: "c", height: 1 })); widget.draw("c", [["rect"]])`),
  ).toMatchObject({ kind: "invalid" })
  expect(
    await failure(
      `widget.render(ui.canvas({ key: "gpu", wgsl: "fn shade(p: vec2f) -> vec4f { return vec4f(1.0); }", height: 1 })); widget.draw("gpu", [])`,
    ),
  ).toMatchObject({ kind: "error", message: expect.stringContaining('Canvas "gpu" is drawn by its wgsl') })
  expect(await failure(`widget.draw("nope", [])`)).toMatchObject({
    kind: "error",
    message: expect.stringContaining('No canvas with key "nope"'),
  })
  expect(
    await failure(
      `widget.render(ui.canvas({ key: "c", height: 1 })); const g = ui.draw(); for (let i = 0; i < 2001; i++) g.save(); widget.draw("c", g)`,
    ),
  ).toMatchObject({ kind: "invalid", message: "2001 draw commands is over the budget of 2000 per frame" })
  expect(
    await failure(`widget.render(ui.button("Go", { onPress: () => { throw new Error("handler") } }))`, (widget) =>
      widget.event(press("0")),
    ),
  ).toMatchObject({ kind: "error", message: expect.stringContaining("handler") })
  expect(
    await failure(`widget.render(ui.button("Go", { onPress: async () => { throw new Error("later") } }))`, (widget) =>
      widget.event(press("0")),
    ),
  ).toMatchObject({ kind: "error", message: expect.stringContaining("later") })
  expect(await failure(`return 1`)).toEqual({ type: "return" })
  // A view without handlers doesn't keep the widget open once main returns.
  expect(await failure(`widget.render(ui.text("bye"))`)).toEqual({ type: "return" })
})

test("a program that runs too long without awaiting is stopped", async () => {
  const busy = {
    type: "error",
    error: { kind: "timeout", message: "The program ran more than 50 ms without awaiting" },
  }
  expect(await start(`async function main() { while (true) {} }`, { busyMs: 50 }).widget.done).toMatchObject(busy)
  const later = start(`async function main() { await widget.frame(); while (true) {} }`, { busyMs: 50 })
  await later.widget.when((current) => current.frameRequested)
  later.widget.frame(size)
  expect(await later.widget.done).toMatchObject(busy)
})

const rendered = (messages: ReadonlyArray<LiveMessage>) =>
  messages.flatMap((message) => (message.type === "render" && message.node.type === "text" ? [message.node.text] : []))

test("renders over the post rate wait and coalesce: the latest goes out at the next slot, and before an answer", async () => {
  // 8 at once (the burst), then the 22 others replace each other until a token comes, a tenth of a second later.
  const { widget, messages, clock } = start(
    `async function main() { for (let i = 0; i < 30; i++) widget.render(ui.text(String(i))); widget.send("posted"); await widget.sleep(1000); widget.submit(1) }`,
    { postsPerSecond: 10 },
  )
  // Once all 30 are posted (a send goes at once), however long the loop took.
  await widget.when(() => messages.some((message) => message.type === "send"))
  await clock.advance(99)
  expect(rendered(messages)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"])
  await clock.advance(1)
  expect(rendered(messages)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "29"])
  expect(widget.view).toEqual({ type: "text", text: "29" })
  await clock.advance(1000)
  expect(await widget.done).toEqual({ type: "submit", value: 1 })
  expect(widget.warnings).toEqual([])
  // Ending, by an answer or by returning, sends what waits first.
  for (const last of [`widget.submit(1)`, `return`]) {
    const { widget, messages } = start(
      `async function main() { for (let i = 0; i < 30; i++) widget.render(ui.text(String(i))); ${last} }`,
      { postsPerSecond: 10 },
    )
    await widget.done
    expect(rendered(messages)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "29"])
    expect(messages.map((message) => message.type).slice(9)).toEqual(last === "return" ? [] : ["submit"])
  }
})

test("a frame request under load is never counted or lost, and draws coalesce by canvas", async () => {
  const { widget, messages, clock } = start(
    `async function main() {
      widget.render(ui.column([ui.canvas({ key: "a", height: 1 }), ui.canvas({ key: "b", height: 1 })]))
      for (let i = 0; i < 20; i++) { widget.draw("a", [["alpha", i / 100]]); widget.draw("b", [["alpha", i / 50]]) }
      const frame = await widget.frame()
      widget.render(ui.text("frame " + frame.t))
    }`,
    { postsPerSecond: 10 },
  )
  await widget.when((current) => current.frameRequested)
  expect(widget.frame({ ...size, t: 1 })).toBe(true)
  // The frame's render waits behind the draws: one token each, a tenth of a second apart.
  await clock.advance(300)
  const draws = messages.flatMap((message) => (message.type === "draw" ? [[message.id, message.commands]] : []))
  expect(draws.slice(7)).toEqual([
    ["0/:b", [["alpha", 0.38]]],
    ["0/:a", [["alpha", 0.19]]],
  ])
  expect(await widget.done).toEqual({ type: "return" })
  expect(widget.view).toEqual({ type: "text", text: "frame 1" })
})

test("a game at 120 Hz posting three times a frame runs every frame and shows its last one", async () => {
  // A render and two draws a frame are 360 posts a second, over the 240: frames keep coming, and the view catches up.
  const { widget, messages, clock } = start(`async function main() {
    for (let n = 0; n < 120; n++) {
      const frame = await widget.frame()
      widget.render(ui.column([ui.text("n " + n), ui.canvas({ key: "a", height: 1 }), ui.canvas({ key: "b", height: 1 })]))
      widget.draw("a", [["alpha", n / 1000]])
      widget.draw("b", [["alpha", n / 200]])
    }
  }`)
  for (let n = 0; n < 120; n++) {
    await widget.when((current) => current.frameRequested)
    expect(widget.frame({ ...size, t: n / 120 })).toBe(true)
    await clock.advance(1000 / 120)
  }
  const counted = messages.filter((message) => message.type === "render" || message.type === "draw")
  // A second's tokens and the burst, and the last frame's three posts, which go out at once when the run returns.
  expect(counted.length).toBeLessThanOrEqual(240 + 8 + 3)
  expect(counted.length).toBeGreaterThan(200)
  expect(await widget.done).toEqual({ type: "return" })
  expect(widget.view && "children" in widget.view ? widget.view.children[0] : undefined).toEqual({
    type: "text",
    text: "n 119",
  })
  expect(widget.drawings.get("0/:b")).toEqual([["alpha", 0.595]])
  expect(messages.filter((message) => message.type === "frame")).toHaveLength(120)
})

test("a draw post without a string key ends the run as an invalid post", async () => {
  for (const post of [
    `__host.post({ type: "draw", id: "0", commands: [] })`,
    `__host.post({ type: "draw", key: 1, commands: [] })`,
  ]) {
    const { widget } = start(`async function main() { widget.render(ui.canvas({ key: "c", height: 1 })); ${post} }`)
    expect(await widget.done).toMatchObject({
      type: "error",
      error: { kind: "invalid", message: "A draw post needs a string key" },
    })
  }
})

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body: new TextEncoder().encode(JSON.stringify(body)),
})

// Runs `widget.fetch(url, init)` and renders what it got: `status json` or the rejection's kind and message.
const fetching = async (url: string, transport: Transport, options: LiveOptions = {}, init = "undefined") => {
  const { widget, clock } = start(
    `
    async function main(data) {
      try {
        const response = await widget.fetch(data.url, ${init})
        widget.render(ui.text(response.ok + " " + response.status + " " + (await response.text())))
      } catch (error) {
        widget.render(ui.text(error.kind + ": " + error.message))
      }
      await widget.sleep(1e9)
    }
  `,
    { capabilities: { https: { hosts: ["api.example.com", "*.cdn.example.org"] } }, transport, ...options },
    { url },
  )
  return { widget, clock }
}
const result = async (url: string, transport: Transport, options: LiveOptions = {}, init?: string) => {
  const { widget } = await fetching(url, transport, options, init)
  await widget.when((current) => current.view !== undefined)
  await widget.stop()
  return shown(widget)
}

test("fetch reaches declared https hosts and returns status, headers and the body", async () => {
  const requests: FetchRequest[] = []
  const transport: Transport = async (request) => {
    requests.push(request)
    return json({ price: 42 })
  }
  expect(await result("https://api.example.com/v1/price", transport)).toBe('true 200 {"price":42}')
  expect(await result("https://img.cdn.example.org/a", transport)).toBe('true 200 {"price":42}')
  expect(
    await result("https://api.example.com/v1", transport, {}, `{ method: "post", headers: { "x-n": 1 }, body: "hi" }`),
  ).toBe('true 200 {"price":42}')
  expect(requests).toEqual([
    { url: "https://api.example.com/v1/price", method: "GET", headers: {} },
    { url: "https://img.cdn.example.org/a", method: "GET", headers: {} },
    { url: "https://api.example.com/v1", method: "POST", headers: { "x-n": "1" }, body: "hi" },
  ])
  const { widget } = start(
    `
    async function main() {
      const response = await widget.fetch("https://api.example.com/x")
      const body = await response.json()
      const image = await widget.fetch("https://api.example.com/png")
      widget.render(ui.text([response.status, response.headers["x-total"], body.items.length, image.ok, (await image.text()).length].join(" ")))
      await widget.sleep(1e9)
    }
  `,
    {
      capabilities: { https: { hosts: ["*"] } },
      transport: async (request) =>
        request.url.endsWith("png")
          ? { status: 404, headers: { "content-type": "image/png" }, body: new Uint8Array([137, 80, 78, 71]) }
          : json({ items: [1, 2] }, 201, { "x-total": "2" }),
    },
  )
  await showing(widget, "201 2 2 false 4")
  await widget.stop()
})

test("fetch rejects what the capability and the contract don't allow", async () => {
  const transport: Transport = async () => json({})
  expect(await result("https://evil.example.com/", transport)).toBe(
    "CapabilityDenied: evil.example.com is not in the widget template's https hosts (api.example.com, *.cdn.example.org)",
  )
  expect(await result("https://cdn.example.org/", transport)).toStartWith("CapabilityDenied: cdn.example.org is not in")
  expect(await result("http://api.example.com/", transport)).toBe(
    "CapabilityDenied: Only https: URLs can be fetched, not http:",
  )
  expect(await result("https://api.example.com/", transport, { capabilities: {} })).toBe(
    "CapabilityDenied: This widget template declares no https capability",
  )
  const any = { capabilities: { https: { hosts: ["*"] } } }
  for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.10", "169.254.169.254", "[::1]", "[fe80::1]"])
    expect(await result(`https://${host}/`, transport, any)).toStartWith("CapabilityDenied:")
  expect(await result("https://api.example.com/", transport, {}, `{ method: "TRACE" }`)).toBe(
    "CapabilityDenied: Method TRACE is not allowed",
  )
  expect(await result("https://api.example.com/", transport, {}, `{ method: "POST", body: "x".repeat(262145) }`)).toBe(
    "TooLarge: The request body is over 256 KB",
  )
  const huge: Transport = async () => ({ status: 200, headers: {}, body: new Uint8Array(2 * 1024 * 1024 + 1) })
  expect(await result("https://api.example.com/", huge)).toBe("TooLarge: The response body is over 2 MB")
  const broken: Transport = async () => {
    throw new Error("connection reset")
  }
  expect(await result("https://api.example.com/", broken)).toBe("Network: connection reset")
})

test("fetch follows up to 5 redirects within the declared hosts", async () => {
  const hops = (count: number, last: string): Transport => {
    const seen = { count: 0 }
    return async (request) => {
      if (seen.count++ < count)
        return { status: 302, headers: { location: `/hop/${seen.count}` }, body: new Uint8Array() }
      if (request.url.endsWith("/away")) throw new Error("must not be reached")
      return seen.count > count && last
        ? { status: 301, headers: { location: last }, body: new Uint8Array() }
        : json(request.url)
    }
  }
  expect(await result("https://api.example.com/", hops(5, ""))).toBe('true 200 "https://api.example.com/hop/5"')
  expect(await result("https://api.example.com/", hops(6, ""))).toBe("Network: More than 5 redirects")
  const away: Transport = async (request) =>
    request.url.includes("evil")
      ? json("reached")
      : { status: 307, headers: { location: "https://evil.example.net/away" }, body: new Uint8Array() }
  expect(await result("https://api.example.com/", away)).toStartWith("CapabilityDenied: evil.example.net is not in")
})

test("fetch is limited to 4 in flight, 10 per second and 15 seconds", async () => {
  const never: Transport = (_, signal) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
  const { widget, clock } = start(
    `
    async function main() {
      const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => widget.fetch("https://api.example.com/" + n)))
      widget.render(ui.text(results.map((r) => r.status === "rejected" ? r.reason.kind : r.value.status).join(" ")))
      await widget.sleep(1e9)
    }
  `,
    { capabilities: { https: { hosts: ["api.example.com"] } }, transport: never },
  )
  await clock.advance(14_999)
  expect(widget.view).toBeUndefined()
  await clock.advance(1)
  await showing(widget, "Timeout Timeout Timeout Timeout RateLimited")
  await widget.stop()

  const quick = start(
    `
    async function main() {
      const kinds = []
      for (let n = 0; n < 11; n++) kinds.push(await widget.fetch("https://api.example.com/").then((r) => r.status, (e) => e.kind))
      widget.render(ui.text(kinds.join(" ")))
      await widget.sleep(1000)
      kinds.push(await widget.fetch("https://api.example.com/").then((r) => r.status, (e) => e.kind))
      widget.render(ui.text(kinds.slice(-2).join(" ")))
      await widget.sleep(1e9)
    }
  `,
    { capabilities: { https: { hosts: ["api.example.com"] } }, transport: async () => json({}) },
  )
  await showing(quick.widget, "200 200 200 200 200 200 200 200 200 200 RateLimited")
  await quick.clock.advance(1000)
  await showing(quick.widget, "RateLimited 200")
  await quick.widget.stop()
})

test("a fetch that completes while paused is held until resume", async () => {
  const gate = Promise.withResolvers<void>()
  const { widget } = await fetching("https://api.example.com/", async () => {
    await gate.promise
    return json("late")
  })
  await Bun.sleep(0)
  widget.pause()
  gate.resolve()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(widget.view).toBeUndefined()
  widget.resume()
  await showing(widget, 'true 200 "late"')
  await widget.stop()
})
