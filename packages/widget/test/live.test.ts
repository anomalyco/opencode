import { expect, test } from "bun:test"
import {
  type FetchRequest,
  type LiveFrame,
  type LiveMessage,
  type LiveOptions,
  LiveWidget,
  ManualClock,
  program,
  type Transport,
} from "../src/index.js"

const size: LiveFrame = { t: 0, dt: 1 / 60, width: 300, height: 200, scale: 2, pointer: null, dark: true }
const press = (id: string) => ({ id, type: "press" as const })

const histories = new WeakMap<LiveWidget, LiveMessage[]>()

const start = (source: string, options: LiveOptions = {}, data: unknown = {}) => {
  const clock = new ManualClock()
  const messages: LiveMessage[] = []
  const widget = LiveWidget.start(program(source), data, {
    clock,
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

test("render, draw, events and submit", async () => {
  const { widget, messages } = start(
    `
    async function main(data) {
      widget.render(ui.column([ui.text(data.title), ui.button("go", "Go")]))
      widget.draw("c", ui.draw().circle(1, 2, 3))
      widget.draw("raw", [["save"], ["restore"]])
      const event = await widget.event()
      widget.send({ got: event.id }, { wake: false })
      widget.submit({ done: true })
      widget.render(ui.text("after submit"))
    }
  `,
    {},
    { title: "Hi" },
  )
  await widget.when((current) => current.view !== undefined)
  expect(widget.view).toEqual({
    type: "column",
    children: [
      { type: "text", text: "Hi" },
      { type: "button", id: "go", label: "Go" },
    ],
  })
  await widget.when((current) => current.drawings.has("raw"))
  expect(widget.drawings.get("c")).toEqual([["circle", 1, 2, 3, { fill: "text" }]])
  widget.event(press("go"))
  expect(await widget.done).toEqual({ type: "submit", value: { done: true } })
  expect(messages.map((message) => message.type)).toEqual(["render", "draw", "draw", "send", "submit"])
  expect(messages[3]).toEqual({ type: "send", value: { got: "go" }, wake: false })
})

test("capturePointer and releasePointer post capture messages; key, focus and capture events reach the program", async () => {
  const { widget, messages } = start(`
    async function main() {
      widget.capturePointer()
      const seen = []
      while (seen.length < 4) {
        const event = await widget.event()
        seen.push(event.type + ":" + JSON.stringify(event.value))
      }
      widget.releasePointer()
      widget.submit(seen)
    }
  `)
  await widget.when(() => messages.length > 0)
  widget.event({ id: "", type: "focus", value: true })
  widget.event({ id: "", type: "capture", value: true })
  widget.event({ id: "view", type: "pointer", value: { kind: "move", dx: 3, dy: -2 } })
  widget.event({
    id: "",
    type: "key",
    value: { kind: "down", key: " ", code: "Space", repeat: false, shift: false, alt: false, ctrl: false, meta: false },
  })
  expect(await widget.done).toMatchObject({
    type: "submit",
    value: [
      "focus:true",
      "capture:true",
      'pointer:{"kind":"move","dx":3,"dy":-2}',
      expect.stringContaining('"code":"Space"'),
    ],
  })
  expect(messages.filter((message) => message.type === "capture")).toEqual([
    { type: "capture", value: true },
    { type: "capture", value: false },
  ])
})

test("frames are requested once and events that arrive meanwhile wait", async () => {
  const { widget, messages } = start(`
    async function main() {
      const frame = await widget.frame()
      const event = await widget.event()
      widget.render(ui.text(frame.width + " " + event.id))
      await widget.event()
      widget.dismiss()
    }
  `)
  await widget.when((current) => current.frameRequested)
  widget.event(press("early"))
  expect(widget.frame(size)).toBe(true)
  expect(widget.frame(size)).toBe(false)
  await showing(widget, "300 early")
  expect(messages.filter((message) => message.type === "frame")).toHaveLength(1)
  widget.event(press("close"))
  expect(await widget.done).toEqual({ type: "dismiss" })
})

test("next returns an event, a frame or a timeout, whichever comes first", async () => {
  const { widget, clock } = start(`
    async function main() {
      const seen = []
      const report = () => widget.render(ui.text(seen.join(",")))
      seen.push((await widget.next({ frame: true })).type)
      report()
      seen.push((await widget.next({ frame: true, timeout: 1000 })).type)
      report()
      seen.push((await widget.next({ timeout: 500 })).type + "@" + widget.now())
      report()
      seen.push((await widget.next({ frame: true, timeout: 100 })).type)
      report()
      await widget.event()
    }
  `)
  await widget.when((current) => current.frameRequested)
  widget.frame(size)
  await showing(widget, "frame")
  widget.event(press("x"))
  await showing(widget, "frame,event")
  await clock.advance(500)
  await showing(widget, "frame,event,timeout@500")
  // The frame requested by the second call is still pending, so the fourth gets it.
  widget.frame(size)
  await showing(widget, "frame,event,timeout@500,frame")
  await widget.stop()
})

test("a paused program gets nothing until it resumes, then hears how long it was paused", async () => {
  const { widget, clock } = start(`
    async function main() {
      const before = widget.now()
      await widget.sleep(1000)
      widget.render(ui.text("slept " + (widget.now() - before)))
      const resumed = await widget.next()
      const event = await widget.next()
      widget.render(ui.text(resumed.type + " " + resumed.pausedMs + " then " + event.event.id + " at " + widget.now()))
      await widget.event()
    }
  `)
  await clock.advance(400)
  widget.pause()
  expect(widget.paused).toBe(true)
  await clock.advance(5000)
  widget.event(press("held"))
  expect(widget.view).toBeUndefined()
  widget.resume()
  await clock.advance(599)
  expect(widget.view).toBeUndefined()
  await clock.advance(1)
  await showing(widget, "slept 1000")
  await showing(widget, "resumed 5000 then held at 1000")
  await widget.stop()
})

test("a program that throws, renders an invalid view or draws too much stops with an error", async () => {
  const failure = async (body: string) => {
    const { widget } = start(`async function main() { ${body} }`)
    const end = await widget.done
    return end.type === "error" ? { kind: end.error.kind, message: end.error.message } : end
  }
  expect(await failure(`throw new Error("boom")`)).toMatchObject({ kind: "error", message: "Error: boom" })
  expect(await failure(`widget.render({ type: "button" })`)).toMatchObject({ kind: "invalid" })
  expect(await failure(`widget.draw("c", [["rect"]])`)).toMatchObject({ kind: "invalid" })
  expect(
    await failure(`const g = ui.draw(); for (let i = 0; i < 2001; i++) g.save(); widget.draw("c", g)`),
  ).toMatchObject({ kind: "invalid", message: expect.stringContaining("at most 2000 commands") })
  expect(await failure(`return 1`)).toEqual({ type: "return" })
})

test("a program that runs too long without awaiting is stopped", async () => {
  const busy = {
    type: "error",
    error: { kind: "timeout", message: "The program ran more than 50 ms without awaiting" },
  }
  expect(await start(`async function main() { while (true) {} }`).widget.done).toMatchObject(busy)
  const later = start(`async function main() { await widget.event(); while (true) {} }`)
  later.widget.event(press("go"))
  expect(await later.widget.done).toMatchObject(busy)
})

test("posts beyond the rate are dropped with one warning; answers always get through", async () => {
  const { widget, messages } = start(
    `async function main() { for (let i = 0; i < 30; i++) widget.render(ui.text(String(i))); widget.submit(1) }`,
    { postsPerSecond: 10 },
  )
  expect(await widget.done).toEqual({ type: "submit", value: 1 })
  expect(messages.filter((message) => message.type === "render")).toHaveLength(10)
  expect(widget.warnings).toEqual(["Dropped posts beyond 10 per second"])
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
      await widget.event()
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
      await widget.event()
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
    "CapabilityDenied: evil.example.com is not in the template's https hosts (api.example.com, *.cdn.example.org)",
  )
  expect(await result("https://cdn.example.org/", transport)).toStartWith("CapabilityDenied: cdn.example.org is not in")
  expect(await result("http://api.example.com/", transport)).toBe(
    "CapabilityDenied: Only https: URLs can be fetched, not http:",
  )
  expect(await result("https://api.example.com/", transport, { capabilities: {} })).toBe(
    "CapabilityDenied: This template declares no https capability",
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
      await widget.event()
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
      await widget.event()
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
