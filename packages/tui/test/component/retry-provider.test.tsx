import { expect, test } from "bun:test"
import { BoxRenderable, RGBA, TextAttributes, TextRenderable } from "@opentui/core"
import { createTestRenderer, ManualClock } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { RetryProvider, RetryProviderRenderable } from "../../src/component/retry-provider"

async function fixture() {
  const clock = new ManualClock()
  const app = await createTestRenderer({ width: 60, height: 2, useThread: false, clock })
  app.renderer.pause()
  const text = new TextRenderable(app.renderer, { fg: "#eeeeee", bg: "#111111", attributes: TextAttributes.BOLD })
  const provider = new RetryProviderRenderable(app.renderer, {
    value: { id: "call-1", provider: "exa", running: true },
  })
  text.add("Web Search via ")
  text.add(provider)
  text.add(' "query"')
  app.renderer.root.add(text)
  const renderOnce = async () => {
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    await app.renderOnce()
  }
  return {
    ...app,
    clock,
    text,
    provider,
    renderOnce,
    step: async (millis: number) => {
      clock.setTime(clock.now() + millis)
      await renderOnce()
    },
    [Symbol.dispose]: () => {
      provider.destroy()
      app.renderer.destroy()
    },
  }
}

test("only an already-painted running call starts a provider transition", async () => {
  using app = await fixture()
  // Updates before the first paint are not a visible retry.
  app.provider.value = { id: "call-1", provider: "parallel", running: true }
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Parallel "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
  app.provider.value = { id: "call-1", provider: "parallel", running: true }
  app.provider.value = { id: "call-1", provider: "parallel", running: false }
  app.provider.value = { id: "call-1", provider: "tavily", running: false }
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Tavily "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
  // A new invocation/history view must not animate from the previous call's label.
  app.provider.value = { id: "call-2", provider: "exa", running: true }
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Exa "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
})

test("fades only the provider, changes width while invisible, and settles without a timer", async () => {
  using app = await fixture()
  await app.renderOnce()
  const initial = app.captureSpans()
  app.clock.setTime(2000)
  app.provider.value = { id: "call-1", provider: "parallel", running: true }
  await app.renderOnce()
  expect(app.captureSpans()).toEqual(initial)
  expect(app.renderer.liveRequestCount).toBe(1)
  await app.step(40)
  const middle = app.captureSpans().lines[0].spans
  expect(middle.find((span) => span.text.includes("Exa"))?.fg.toInts()).not.toEqual(
    initial.lines[0].spans[0].fg.toInts(),
  )
  expect(middle.find((span) => span.text.includes("Web Search"))?.fg.toInts()).toEqual(
    initial.lines[0].spans[0].fg.toInts(),
  )
  expect(middle.find((span) => span.text.includes("query"))?.fg.toInts()).toEqual(initial.lines[0].spans[0].fg.toInts())
  expect(
    middle.filter((span) => span.text.trim()).every((span) => Boolean(span.attributes & TextAttributes.BOLD)),
  ).toBe(true)
  await app.step(40)
  const before = app.captureCharFrame().indexOf('"query"')
  await app.step(30)
  const moving = app.captureCharFrame().indexOf('"query"')
  expect(moving).toBeGreaterThan(before)
  expect(moving).toBeLessThan("Web Search via Parallel ".length)
  await app.step(30)
  await app.step(80)
  expect(app.captureCharFrame().trim()).toBe('Web Search via Parallel "query"')
  expect(app.captureSpans().lines[0].spans[0].fg.toInts()).toEqual(initial.lines[0].spans[0].fg.toInts())
  expect(app.renderer.liveRequestCount).toBe(0)
})

test("coalesces rapid fallbacks and does not restart on completion", async () => {
  using app = await fixture()
  await app.renderOnce()
  app.provider.value = { id: "call-1", provider: "parallel", running: true }
  await app.renderOnce()
  await app.step(40)
  app.provider.value = { id: "call-1", provider: "firecrawl", running: true }
  app.provider.value = { id: "call-1", provider: "firecrawl", running: false }
  await app.step(180)
  expect(app.captureCharFrame().trim()).toBe('Web Search via Firecrawl "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
})

test("retargets a fading-in provider without flashing back to full brightness", async () => {
  using app = await fixture()
  await app.renderOnce()
  app.provider.value = { id: "call-1", provider: "parallel", running: true }
  await app.renderOnce()
  await app.step(180)
  const middle = app.captureSpans()
  app.provider.value = { id: "call-1", provider: "tavily", running: true }
  await app.renderOnce()
  expect(app.captureSpans()).toEqual(middle)
  await app.step(220)
  expect(app.captureCharFrame().trim()).toBe('Web Search via Tavily "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
})

test("disabling animations settles immediately and recursive destruction releases active work", async () => {
  using app = await fixture()
  await app.renderOnce()
  app.provider.value = { id: "call-1", provider: "parallel", running: true }
  await app.renderOnce()
  app.provider.enabled = false
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Parallel "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
  app.provider.value = { id: "call-1", provider: "exa", running: true }
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Exa "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
  app.provider.enabled = true
  app.provider.value = { id: "call-1", provider: "tavily", running: true }
  expect(app.renderer.liveRequestCount).toBe(1)
  app.text.remove(app.provider)
  app.provider.destroyRecursively()
  expect(app.renderer.liveRequestCount).toBe(0)
})

test("a hidden first paint does not arm the transition", async () => {
  using app = await fixture()
  app.text.visible = false
  await app.renderOnce()
  app.provider.value = { id: "call-1", provider: "parallel", running: true }
  await app.renderOnce()
  expect(app.renderer.liveRequestCount).toBe(0)
  app.text.visible = true
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Parallel "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
  app.provider.value = { id: "call-1", provider: "tavily", running: true }
  expect(app.renderer.liveRequestCount).toBe(1)
})

test("offscreen and ancestor-clipped rows show the latest provider on entry, without animation", async () => {
  using app = await fixture()
  app.text.top = 4
  await app.renderOnce()
  app.provider.value = { id: "call-1", provider: "parallel", running: true }
  await app.renderOnce()
  expect(app.renderer.liveRequestCount).toBe(0)
  app.text.top = 0
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Parallel "query"')
  const clip = new BoxRenderable(app.renderer, { width: 50, height: 1, overflow: "hidden" })
  app.renderer.root.remove(app.text)
  clip.add(app.text)
  app.renderer.root.add(clip)
  app.text.top = 1
  await app.renderOnce()
  app.provider.value = { id: "call-1", provider: "tavily", running: true }
  await app.renderOnce()
  expect(app.renderer.liveRequestCount).toBe(0)
  app.text.top = 0
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Tavily "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
})

test("a transition settles when hidden and waits for a new paint before animating again", async () => {
  using app = await fixture()
  await app.renderOnce()
  app.provider.value = { id: "call-1", provider: "parallel", running: true }
  await app.renderOnce()
  await app.step(40)
  app.text.visible = false
  await app.step(40)
  expect(app.renderer.liveRequestCount).toBe(0)
  expect(app.captureCharFrame().trim()).toBe("")
  app.text.visible = true
  app.provider.value = { id: "call-1", provider: "tavily", running: true }
  expect(app.renderer.liveRequestCount).toBe(0)
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Tavily "query"')
  app.provider.value = { id: "call-1", provider: "exa", running: true }
  expect(app.renderer.liveRequestCount).toBe(1)
  app.text.top = 4
  await app.step(40)
  expect(app.renderer.liveRequestCount).toBe(0)
  app.text.top = 0
  await app.renderOnce()
  expect(app.captureCharFrame().trim()).toBe('Web Search via Exa "query"')
  expect(app.renderer.liveRequestCount).toBe(0)
})

test("Solid unmount releases a running transition and its frame listener", async () => {
  const clock = new ManualClock()
  const [visible, setVisible] = createSignal(true)
  const [provider, setProvider] = createSignal("exa")
  const app = await testRender(
    () => (
      <Show when={visible()}>
        <text fg="#eeeeee">
          Web Search via <RetryProvider value={{ id: "call", provider: provider(), running: true }} enabled={true} />
        </text>
      </Show>
    ),
    { width: 60, height: 2, useThread: false, clock },
  )
  try {
    app.renderer.pause()
    await app.renderOnce()
    setProvider("parallel")
    await app.waitFor(() => app.renderer.liveRequestCount === 1)
    setVisible(false)
    await app.waitFor(() => app.renderer.liveRequestCount === 0)
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("")
    expect(app.renderer.listenerCount("frame")).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

test("the Solid inline span inherits colors and wraps like ordinary text after a Unicode retry", async () => {
  const clock = new ManualClock()
  const [provider, setProvider] = createSignal("firecrawl")
  const [running, setRunning] = createSignal(true)
  const app = await testRender(
    () => (
      <box width={24}>
        <text fg="#222222" bg="#eeeeee">
          Web Search via{" "}
          <RetryProvider value={{ id: "call", provider: provider(), running: running() }} enabled={true} /> "a longer
          query"
        </text>
        <text fg="#222222" bg="#eeeeee">
          Web Search via 日本語 "a longer query"
        </text>
      </box>
    ),
    { width: 24, height: 6, useThread: false, clock },
  )
  try {
    app.renderer.pause()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Firecrawl")
    setProvider("日本語")
    await app.renderOnce()
    clock.setTime(220)
    await app.renderOnce()
    setRunning(false)
    await app.renderOnce()
    const lines = app
      .captureCharFrame()
      .trimEnd()
      .split("\n")
      .map((line) => line.trimEnd())
    expect(lines.slice(0, 2)).toEqual(lines.slice(2, 4))
    expect(app.captureCharFrame()).not.toContain("Firecrawl")
    expect(app.captureSpans().lines[0].spans[0].fg.equals(RGBA.fromHex("#222222"))).toBe(true)
    expect(app.renderer.liveRequestCount).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})
