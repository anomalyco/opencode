#!/usr/bin/env bun
// Checks the demo in a real Chromium: every fixture renders, controls submit what they should, canvases draw, shaders
// run on WebGPU (GPU canvases replay their batches), live widgets pause out of view, full screen, the slice budget and the fetch rules; prints
// timings and memory. Needs the demo server (bun scripts/serve.ts).
//
//   xvfb-run -a bun scripts/check.ts      # headful under Xvfb: headless screenshots leave WebGPU canvases blank
//
// Env: CHROMIUM (executable), DEMO (base URL), SHOTS (directory for web-*.png screenshots; none when unset).
import { chromium, type Locator, type Page } from "playwright-core"

const exe = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`
const base = process.env.DEMO ?? "http://localhost:4173/demo/"
const shots = process.env.SHOTS
const browser = await chromium.launch({
  executablePath: exe,
  headless: !process.env.DISPLAY,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"],
})

let failures = 0
const check = (ok: boolean, what: string, detail?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail === undefined ? "" : ` (${JSON.stringify(detail)})`}`)
  if (!ok) failures++
}
const shot = async (target: Page | Locator, name: string, fullPage = false) => {
  if (!shots) return
  const path = `${shots}/web-${name}.png`
  if ("goto" in target) await target.screenshot({ path, fullPage })
  else await target.screenshot({ path })
}

/**
 * WebGPU completion as the checks see it: done when the GPU is, or after 100 ms at most. SwiftShader's own times (about
 * 200 ms a frame for the demo shader, up to about 300 ms for a fresh device's first submits) are this environment's, not
 * what a check is about, and would trip the 250 ms GPU hang rule. The hang and slow-shader checks set their own times.
 */
const steady = () => {
  if (typeof GPUQueue === "undefined") return
  const done = GPUQueue.prototype.onSubmittedWorkDone
  GPUQueue.prototype.onSubmittedWorkDone = function (this: GPUQueue) {
    return Promise.race([done.call(this), new Promise<undefined>((r) => setTimeout(() => r(undefined), 100))])
  }
}

async function open(query: string, viewport = { width: 1280, height: 900 }, deviceScaleFactor = 1): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport, deviceScaleFactor })
  await page.addInitScript(steady)
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text())
  })
  await page.goto(base + query)
  return { page, errors }
}

const log = (page: Page) => page.evaluate(() => (window as unknown as { __demo: { log: string[] } }).__demo.log)
const widget = (page: Page, name: string) => page.locator(`.slot[data-name="${name}"] .psychoscript-widget`)

async function waitLog(page: Page, match: (line: string) => boolean, ms = 3000): Promise<string | undefined> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const hit = (await log(page)).find(match)
    if (hit) return hit
    await page.waitForTimeout(50)
  }
  return undefined
}

/** Scrolls `w` into view and waits for its first view (or error card). */
async function rendered(w: Locator): Promise<"view" | "error" | "timeout"> {
  await w.scrollIntoViewIfNeeded()
  try {
    await w.locator(".pw-view > :not(.pw-loading)").first().waitFor({ timeout: 5000 })
  } catch {
    return "timeout"
  }
  return (await w.locator(".pw-error-card").count()) > 0 ? "error" : "view"
}

/** Painted pixels on each Canvas2D canvas of `w` (WebGPU/WebGL canvases are skipped). */
const painted = (w: Locator) =>
  w.evaluate((el) =>
    [...el.shadowRoot!.querySelectorAll(".pw-surface[data-kind='2d'] canvas")].flatMap((c) => {
      const ctx = c.getContext("2d")
      if (!ctx || c.width === 0) return []
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++
      return [n]
    }),
  )

const expandShown = (w: Locator) =>
  w.evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector(".pw-expand")!).display !== "none")

// ---------- every fixture, dark and light ----------
{
  const { page, errors } = await open("", { width: 1400, height: 1000 })
  const names = await page.evaluate(() => Object.keys((window as unknown as { __demo: { widgets: object } }).__demo.widgets))
  const surfaces = new Set(["chart", "backdrop", "minigame", "fullscreen-demo"])
  for (const name of names) {
    const w = widget(page, name)
    const state = await rendered(w)
    check(state === "view", `${name}: renders`, state === "view" ? undefined : state)
    if ((await w.locator(".pw-surface").count()) > 0) surfaces.add(name)
    if ((await w.locator(".pw-surface[data-kind='2d']").count()) > 0 && name !== "minigame") {
      await page.waitForTimeout(150)
      const px = await painted(w)
      check(px.length > 0 && px.every((n) => n > 100), `${name}: canvas drawn`, px)
    }
  }
  for (const name of names) {
    const live = await page.evaluate((n) => (window as unknown as { __demo: { fixtures: Record<string, { mode: string }> } }).__demo.fixtures[n]!.mode === "live", name)
    const want = name === "fetch-demo" || name === "local-demo" || name === "keys-live" ? false : surfaces.has(name) || live
    check((await expandShown(widget(page, name))) === want, `${name}: full-screen button ${want ? "offered" : "not offered"}`)
  }
  check(errors.length === 0, "all: no page errors", errors.slice(0, 3))
  // Only program errors reach the report hook: here only the shader that doesn't validate. The backdrop shader that
  // SwiftShader can't run at 50 ms a frame is this device's problem, a client error.
  const reports = (await log(page)).filter((l) => / report /.test(l))
  check(
    reports.length === 1 && /^shader-broken report \{"phase":"shader","message":".*WGSL line 2/.test(reports[0]!),
    "failures: rendering every fixture reports only the broken shader's WGSL",
    reports,
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
  await shot(page, "all-dark", true)

  // Mounting into a warm page: the worker and module are loaded, the interpreter compiled.
  const warm: number[] = []
  for (const name of ["confirm", "form", "chart", "pie", "suggestions"])
    warm.push(await page.evaluate((n) => (window as unknown as { __demo: { mount(n: string): Promise<number> } }).__demo.mount(n), name))
  const stats = await page.evaluate(() => (window as unknown as { __demo: { host: { stats(): Promise<unknown> } } }).__demo.host.stats())
  const metrics = await page.evaluate(() => (window as unknown as { __demo: { metrics: Record<string, number[]> } }).__demo.metrics)
  const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)
  await page.evaluate(() => {
    for (const w of (window as unknown as { __demo: { extra: { destroy(): void }[] } }).__demo.extra) w.destroy()
    for (const s of document.querySelectorAll(".slot:not([data-name])")) s.remove()
    window.scrollTo(0, 0)
  })

  await page.locator("#theme").click()
  await page.waitForTimeout(800)
  await shot(page, "all-light", true)
  check(
    await widget(page, "confirm").evaluate((el) => getComputedStyle(el).getPropertyValue("--pw-bg").trim() === "#ffffff"),
    "theme: light tokens applied",
  )

  const q = (v: number[], p: number) => {
    const s = [...v].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(p * s.length))]!
  }
  const fmt = (v: number[] = []) =>
    v.length ? `median ${q(v, 0.5).toFixed(1)}  p95 ${q(v, 0.95).toFixed(1)}  max ${Math.max(...v).toFixed(1)}  (n=${v.length})` : "-"
  console.log("\ntimings in ms (Chromium, this VM, software GPU)")
  console.log("  first view, warm page :", fmt(warm), "(mount -> view on screen, worker running)")
  console.log("  compile               :", fmt(metrics.compile))
  console.log("  step (init/update)    :", fmt(metrics.step))
  console.log("  draw                  :", fmt(metrics.draw))
  console.log("memory:", JSON.stringify(stats), `page JS heap ${(heap / 1048576).toFixed(1)} MB`, "\n")
  await page.close()
}

// ---------- first view on a fresh page: the module fetched and compiled, a worker started and warmed ----------
{
  const runs: Record<string, number[]> = {}
  for (const name of ["confirm", "chart", "confirm", "chart", "confirm", "chart"]) {
    const { page } = await open(`?only=${name}`)
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const d = (window as unknown as { __demo: { metrics: Record<string, number[]> } }).__demo
          const t = setInterval(() => {
            if (d.metrics.init?.length) {
              clearInterval(t)
              resolve(d.metrics.init[0]!)
            }
          }, 5)
        }),
    )
    ;(runs[name] ??= []).push(ms)
    await page.close()
  }
  console.log("first view on a fresh page, ms (mount -> view on screen; 1st run cold, then HTTP and code cache warm):")
  for (const [name, v] of Object.entries(runs)) console.log(`  ${name.padEnd(8)} ${v.map((n) => n.toFixed(0)).join(", ")}`)
  console.log()
}

// ---------- controls submit ----------
{
  const { page, errors } = await open("?only=confirm")
  const w = widget(page, "confirm")
  await rendered(w)
  await shot(w, "confirm")
  await w.locator("button.pw-btn", { hasText: "Delete" }).click()
  const line = await waitLog(page, (l) => l.startsWith("confirm submit"))
  check(line === 'confirm submit {"confirmed":true}', "confirm: pressing Delete submits { confirmed: true }", line)
  check(await w.locator(".pw-status").textContent().then((t) => t?.startsWith("Submitted") ?? false), "confirm: read-only with a status line")
  check(errors.length === 0, "confirm: no page errors", errors)
  await page.close()
}
{
  const { page, errors } = await open("?only=suggestions")
  const w = widget(page, "suggestions")
  await rendered(w)
  await w.locator(".pw-card").nth(0).locator(".pw-next").click()
  await page.waitForTimeout(350)
  await w.locator(".pw-card").nth(1).click()
  await w.locator(".pw-card.pw-selected").first().waitFor({ timeout: 3000 })
  await w.locator("input.pw-input").fill("ship it")
  await w.locator("input.pw-input").press("Enter")
  await page.waitForTimeout(200)
  await shot(w, "suggestions")
  await w.locator("button.pw-btn", { hasText: "Choose" }).click()
  const line = await waitLog(page, (l) => l.startsWith("suggestions submit"))
  check(line === 'suggestions submit {"choice":"Minimal","index":1,"note":"ship it"}', "suggestions: carousel arrow, card, note and Choose submit", line)
  check(errors.length === 0, "suggestions: no page errors", errors)
  await page.close()
}
{
  const { page, errors } = await open("?only=form&theme=light")
  const w = widget(page, "form")
  await rendered(w)
  await w.locator("input.pw-input").first().fill("v2.0")
  await w.locator("input.pw-input").first().blur()
  const slider = w.locator("input.pw-slider")
  await slider.focus()
  await slider.press("ArrowRight")
  await w.locator(".pw-check input").click()
  await w.locator(".pw-option", { hasText: "EU West" }).click()
  await page.waitForTimeout(200)
  await shot(w, "form-light")
  await w.locator("button.pw-btn", { hasText: "Deploy" }).click()
  const line = await waitLog(page, (l) => l.startsWith("form submit"))
  const value = line ? JSON.parse(line.slice("form submit ".length)) : undefined
  check(
    value?.name === "v2.0" && value?.replicas === 3 && value?.canary === false && value?.region === "eu-west",
    "form: text, slider, checkbox and select reach the submitted value",
    value,
  )
  check(errors.length === 0, "form: no page errors", errors)
  await page.close()
}

// ---------- chart: pointer down shows the value, a tap submits ----------
{
  const { page, errors } = await open("?only=chart")
  const w = widget(page, "chart")
  await rendered(w)
  await page.waitForTimeout(900)
  const box = (await w.locator("canvas").boundingBox())!
  const before = await painted(w)
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.6)
  await page.mouse.down()
  await page.waitForTimeout(400)
  const caption = await w.locator(".pw-text").allTextContents()
  await shot(w, "chart-pointer")
  await page.mouse.up()
  const line = await waitLog(page, (l) => l.startsWith("chart submit"))
  check(before[0]! > 1000, "chart: animated in and drawn", before)
  check(caption.some((t) => /\d/.test(t) && /s\b/.test(t)), "chart: holding the pointer shows the value", caption)
  check(line !== undefined && /"series":"(Linux|macOS)"/.test(line), "chart: a tap submits { series, index, value }", line)
  check(errors.length === 0, "chart: no page errors", errors)
  await page.close()
}

// ---------- backdrop on WebGPU ----------
for (const [query, backend] of [["?only=backdrop", "webgpu"]] as const) {
  const { page, errors } = await open(query)
  const w = widget(page, "backdrop")
  await rendered(w)
  await w.locator(`.pw-surface[data-backend="${backend}"]`).waitFor({ timeout: 8000 }).catch(() => {})
  const got = await w.evaluate((el) => (el.shadowRoot!.querySelector(".pw-surface") as HTMLElement).dataset.backend)
  check(got === backend, `backdrop: shader runs on ${backend}`, got)
  await page.waitForTimeout(600)
  await shot(w, `backdrop-${backend}`)
  // The slider sets the speed (values[0]) on release.
  const slider = w.locator("input.pw-slider")
  await slider.focus()
  await slider.press("ArrowLeft")
  await page.waitForTimeout(200)
  check((await w.locator(".pw-slider-value").textContent()) !== "1", "backdrop: speed slider updates the view")
  check(errors.length === 0, `backdrop (${backend}): no page errors`, errors)
  await page.close()
}

// ---------- a slow shader: one frame drawing at a time, stopped after three slow frames, its last frame kept ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  // Every frame takes 80 ms on the GPU, whatever SwiftShader takes (its onSubmittedWorkDone resolves then); a submit
  // while one waits stacks.
  await page.addInitScript(() => {
    const w = window as unknown as { __gpuSlow: { submits: number; stacked: number; waiting: number } }
    const slow = (w.__gpuSlow = { submits: 0, stacked: 0, waiting: 0 })
    GPUQueue.prototype.onSubmittedWorkDone = function (this: GPUQueue) {
      slow.waiting++
      return new Promise<undefined>((r) => setTimeout(() => (slow.waiting--, r(undefined)), 80))
    }
    const submit = GPUQueue.prototype.submit
    GPUQueue.prototype.submit = function (this: GPUQueue, buffers: Iterable<GPUCommandBuffer>) {
      slow.submits++
      if (slow.waiting > 0) slow.stacked++
      return submit.call(this, buffers)
    }
  })
  await page.goto(base + "?only=shader-demo")
  const w = widget(page, "shader-demo")
  const message = "the shader took over 50 ms a frame, three frames in a row"
  // Built first (SwiftShader compiles for seconds), then three slow frames.
  await w.locator('.pw-surface[data-backend="webgpu"]').waitFor({ timeout: 20000 }).catch(() => {})
  const line = await waitLog(page, (l) => l.startsWith("shader-demo client-error"), 8000)
  const at = await page.evaluate(() => (window as unknown as { __gpuSlow: { submits: number } }).__gpuSlow.submits)
  await page.waitForTimeout(600)
  const slow = await page.evaluate(() => (window as unknown as { __gpuSlow: { submits: number; stacked: number } }).__gpuSlow)
  const png = await w.locator(".pw-surface canvas").screenshot()
  const colors = await page.evaluate(async (bytes) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }))
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!
    g.drawImage(bmp, 0, 0)
    const seen = new Set<string>()
    for (let y = 0.1; y < 1; y += 0.2) for (let x = 0.1; x < 1; x += 0.2) seen.add(g.getImageData(Math.floor(x * bmp.width), Math.floor(y * bmp.height), 1, 1).data.join())
    return seen.size
  }, [...png])
  check(line === `shader-demo client-error ${message}`, "shader: three frames unfinished 50 ms after their submit stop it, the native message", line)
  check(slow.stacked === 0 && slow.submits >= 3, `shader: never a frame while the last is drawing (${slow.submits} submits, ${slow.stacked} stacked)`, slow)
  check(slow.submits === at && colors > 1, "shader: stopped, no frame after; its last frame stays on the canvas", { at, submits: slow.submits, colors })
  check(errors.length === 0, "shader (slow): no page errors", errors)
  await page.close()
}

// ---------- a shader frame unfinished 250 ms after its submit: a GPU hang, before the 50 ms rule ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  // Two slow frames (80 ms), then one that takes 1.5 s, whatever SwiftShader takes: the 50 ms rule would stop it when
  // that one finishes.
  await page.addInitScript(() => {
    const w = window as unknown as { __gpuSlow: { submits: number; waits: number } }
    const slow = (w.__gpuSlow = { submits: 0, waits: 0 })
    GPUQueue.prototype.onSubmittedWorkDone = function (this: GPUQueue) {
      const ms = ++slow.waits >= 3 ? 1500 : 80
      return new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))
    }
    const submit = GPUQueue.prototype.submit
    GPUQueue.prototype.submit = function (this: GPUQueue, buffers: Iterable<GPUCommandBuffer>) {
      slow.submits++
      return submit.call(this, buffers)
    }
  })
  await page.goto(base + "?only=shader-demo")
  const w = widget(page, "shader-demo")
  await w.locator('.pw-surface[data-backend="webgpu"]').waitFor({ timeout: 20000 }).catch(() => {})
  const message = "the GPU work hung; the canvas is stopped"
  await waitLog(page, (l) => l.startsWith("shader-demo client-error"), 8000)
  // The 1.5 s frame finishes after the hang: nothing more.
  await page.waitForTimeout(1500)
  const lines = (await log(page)).filter((l) => l.startsWith("shader-demo client-error"))
  const slow = await page.evaluate(() => (window as unknown as { __gpuSlow: { submits: number } }).__gpuSlow)
  const alt = await w.evaluate((el) => el.shadowRoot!.querySelector(".pw-surface .pw-alt")?.textContent ?? "")
  check(
    lines.length === 1 && lines[0] === `shader-demo client-error ${message}` && slow.submits === 3 && alt.endsWith(message),
    "shader: a frame unfinished 250 ms after its submit stops it (a GPU hang, its placeholder with the message), before the 50 ms rule",
    { lines, slow, alt },
  )
  check(errors.length === 0, "shader (hang): no page errors", errors)
  await page.close()
}

// ---------- shader pointer events, values-only updates ----------
for (const [query, backend] of [["?only=shader-demo", "webgpu"]] as const) {
  const { page, errors } = await open(query)
  const w = widget(page, "shader-demo")
  await rendered(w)
  await w.locator(`.pw-surface[data-backend="${backend}"]`).waitFor({ timeout: 8000 }).catch(() => {})
  await w.evaluate((el) => ((el.shadowRoot!.querySelector(".pw-surface canvas") as HTMLCanvasElement & { mark?: number }).mark = 1))
  const caption = async () => (await w.locator(".pw-caption").textContent()) ?? ""
  const frames = async () => Number(/frames (\d+)/.exec(await caption())?.[1] ?? 0)
  const f0 = await frames()
  await page.waitForTimeout(1000)
  const f1 = await frames()
  const box = (await w.locator("canvas").boundingBox())!
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(box.x + box.width * (0.3 + i * 0.05), box.y + box.height * 0.5)
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(150)
  await shot(w, `shader-pointer-${backend}`)
  await page.mouse.up()
  await page.waitForTimeout(300)
  const text = await caption()
  const same = await w.evaluate((el) => {
    const s = el.shadowRoot!.querySelector(".pw-surface") as HTMLElement
    return { mark: (s.querySelector("canvas") as HTMLCanvasElement & { mark?: number }).mark, builds: s.dataset.builds, backend: s.dataset.backend }
  })
  check(same.backend === backend, `shader (${backend}): runs`, same.backend)
  check(f1 - f0 > 10, `shader (${backend}): the live program re-renders it every frame (${f1 - f0} frames in 1 s)`)
  check(same.mark === 1 && same.builds === "1", `shader (${backend}): new values reuse the element and the GPU pipeline`, same)
  const m = /down (\d+) · move (\d+) · up (\d+)/.exec(text)
  check(m !== null && m[1] === "1" && m[3] === "1" && Number(m[2]) >= 1 && Number(m[2]) <= 8, `shader (${backend}): pointer down, moves (at most one a frame) and up reach the program`, text)
  check(/hover [1-9]/.test(text), `shader (${backend}): hover moves (down: false) before the press`, text)
  check(errors.length === 0, `shader (${backend}): no page errors`, errors)
  await page.close()
}

// ---------- stack: a HUD over a GPU canvas ----------
{
  const { page, errors } = await open("?only=hud-demo")
  const w = widget(page, "hud-demo")
  await rendered(w)
  await w.locator(".pw-surface[data-backend]").waitFor({ timeout: 8000 }).catch(() => {})
  const geo = () =>
    w.evaluate((el) => {
      const r = (e: Element | null) => {
        const b = e!.getBoundingClientRect()
        return { x: Math.round(b.left), y: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }
      }
      const root = el.shadowRoot!
      return {
        stack: r(root.querySelector(".pw-stack")),
        canvas: r(root.querySelector(".pw-stack > .pw-surface")),
        glass: (root.querySelectorAll(".pw-stack > .pw-surface")[1] as HTMLElement | undefined)?.hasAttribute("data-pointer"),
        sky: (root.querySelector(".pw-stack > .pw-surface") as HTMLElement).hasAttribute("data-pointer"),
        hud: r(root.querySelector(".pw-stack > .pw-col")),
        button: r(root.querySelector(".pw-stack > .pw-btn")),
        kind: (root.querySelector(".pw-surface") as HTMLElement).dataset.kind,
      }
    })
  const g = await geo()
  check(g.kind === "gpu", "stack: a canvas with wgsl is a GPU canvas", g.kind)
  check(
    JSON.stringify(g.canvas) === JSON.stringify(g.stack) && g.stack.b - g.stack.y === 220,
    "stack: the fill canvas takes the whole stack, as tall as the tallest child (220)",
    g,
  )
  check(g.hud.x === g.stack.x + 12 && g.hud.y === g.stack.y + 12, "stack: the HUD sits top-left, inset 12", g.hud)
  check(g.sky === true && g.glass === false, "stack: only the canvas with onPointer takes input (pointer: true); the keyed vignette doesn't", g)
  check(g.button.r === g.stack.r - 12 && g.button.b === g.stack.b - 12, "stack: the button sits bottom-right, inset 12", g.button)
  const caption = async () => (await w.locator(".pw-code").textContent()) ?? ""
  const until = async (re: RegExp) => {
    const end = Date.now() + 3000
    let t = await caption()
    while (Date.now() < end && !re.test(t)) {
      await page.waitForTimeout(50)
      t = await caption()
    }
    return t
  }
  await w.locator(".pw-stack > .pw-btn").click()
  let t = await until(/button presses 1/)
  check(/canvas taps 0 · button presses 1/.test(t), "stack: the button on top takes its tap", t)
  await page.mouse.click((g.stack.x + g.stack.r) / 2, (g.stack.y + g.stack.b) / 2)
  t = await until(/canvas taps 1/)
  check(/canvas taps 1 · button presses 1/.test(t), "stack: a tap on empty space passes the keyed canvas and reaches the one with onPointer", t)
  const title = (await w.locator(".pw-stack .pw-title").boundingBox())!
  await page.mouse.click(title.x + 10, title.y + title.height / 2)
  t = await until(/canvas taps 2/)
  check(/canvas taps 2 · button presses 1/.test(t), "stack: text lets taps through to the canvas", t)
  // Clicked away first: no focus ring or hint in the picture.
  await page.mouse.click(5, 5)
  await page.mouse.move(5, 5)
  await page.waitForTimeout(400)
  if (shots) await page.locator('.slot[data-name="hud-demo"]').screenshot({ path: `${shots}/canvas-stack/web.png` })
  // Directions are physical: right-to-left doesn't move top-left or bottom-right.
  await w.evaluate((el) => (el.dir = "rtl"))
  await page.waitForTimeout(200)
  const rtl = await geo()
  check(rtl.hud.x === rtl.stack.x + 12 && rtl.button.r === rtl.stack.r - 12, "stack: place and inset don't flip right-to-left", rtl)
  await w.evaluate((el) => el.removeAttribute("dir"))
  // Full screen: the stack grows like a canvas and its fill canvas with it; the button stays in its corner.
  await w.hover()
  await w.locator(".pw-expand").click()
  await page.waitForFunction(() => document.fullscreenElement !== null, undefined, { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(800)
  const f = await geo()
  check(
    f.stack.b - f.stack.y > 500 && JSON.stringify(f.canvas) === JSON.stringify(f.stack) && f.button.b === f.stack.b - 12 && f.button.r === f.stack.r - 12,
    "stack: in full screen it grows, its fill canvas with it, the button still bottom-right",
    f,
  )
  await page.keyboard.press("Escape")
  await page.waitForTimeout(400)
  check(errors.length === 0, "stack: no page errors", errors)
  await page.close()
}

// ---------- stack: a HUD over a plain GPU canvas, as tall as its canvas at any width ----------
{
  // Console's HUD artifact: a wgsl canvas with no key or handler fills the stack; the canvas element's own aspect
  // (300 x 150 until sized) once set the stack's height when wide.
  const source = `const WGSL = \`fn shade(frag: vec2f) -> vec4f { return vec4f(frag / widget.resolution, 0.5, 1.0); }\`
function init() { return { boost: 0 } }
function view(state, data) {
  return ui.stack({}, [
    ui.canvas({ wgsl: WGSL, height: 220, values: [state.boost, 0, 0, 0], fps: 60, place: "fill", alt: "Waves" }),
    ui.column({ place: "top-left", inset: 14, gap: 0 }, [
      ui.text(data.title, { style: "title" }),
      ui.text("Boost level " + state.boost, { style: "caption", tone: "muted" }),
    ]),
    ui.button("Boost", { place: "bottom-right", inset: 14, variant: "primary", onPress: (s) => ({ ...s, boost: s.boost + 1 }) }),
  ])
}`
  for (const width of [1280, 700]) {
    const { page, errors } = await open("?only=confirm", { width, height: 900 })
    await page.evaluate((source) => {
      const d = (window as unknown as { __demo: { host: { mount(el: HTMLElement, o: object): unknown }; prelude: string; program(source: string, mode: string): string } }).__demo
      const slot = document.createElement("div")
      slot.className = "slot"
      slot.dataset.name = "hud-shape"
      slot.style.gridColumn = "1 / -1"
      document.getElementById("widgets")!.prepend(slot)
      d.host.mount(slot, { program: d.prelude + "\n" + source, data: { title: "HUD" }, mode: "step", theme: "dark" })
    }, source)
    const w = widget(page, "hud-shape")
    await rendered(w)
    await w.locator(".pw-surface[data-backend]").waitFor({ timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(500)
    const geo = () =>
      w.evaluate((el) => {
        const r = (e: Element | null) => {
          const b = e!.getBoundingClientRect()
          return { x: Math.round(b.left), y: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }
        }
        const root = el.shadowRoot!
        return {
          stack: r(root.querySelector(".pw-stack")),
          canvas: r(root.querySelector(".pw-stack > .pw-surface")),
          hud: r(root.querySelector(".pw-stack > .pw-col")),
          button: r(root.querySelector(".pw-stack > .pw-btn")),
        }
      })
    const placed = (g: Awaited<ReturnType<typeof geo>>) =>
      JSON.stringify(g.canvas) === JSON.stringify(g.stack) &&
      g.hud.x === g.stack.x + 14 && g.hud.y === g.stack.y + 14 &&
      g.button.r === g.stack.r - 14 && g.button.b === g.stack.b - 14
    const g = await geo()
    check(g.stack.b - g.stack.y === 220 && placed(g), `stack (HUD, ${width} px): 220 tall like its fill canvas, HUD and button in their corners`, g)
    await w.hover()
    await w.locator(".pw-expand").click()
    await page.waitForFunction(() => document.fullscreenElement !== null, undefined, { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(800)
    const f = await geo()
    check(f.stack.b - f.stack.y > 500 && placed(f), `stack (HUD, ${width} px): in full screen it grows with its canvas, corners kept`, f)
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => document.fullscreenElement === null, undefined, { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(500)
    const back = await geo()
    check(back.stack.b - back.stack.y === 220 && placed(back), `stack (HUD, ${width} px): back inline at 220`, back)
    check(errors.length === 0, `stack (HUD, ${width} px): no page errors`, errors)
    await page.close()
  }
}

// ---------- never draw at zero size ----------
{
  const { page, errors } = await open("?only=confirm")
  const got = await page.evaluate(async () => {
    const d = (window as unknown as { __demo: { host: { mount(el: HTMLElement, o: object): { setTheme(t: string): void; destroy(): void } }; fixtures: Record<string, { source: string; data: unknown; mode: string }>; prelude: string; program(source: string, mode: string): string } }).__demo
    const slot = document.createElement("div")
    slot.style.width = "420px"
    document.body.prepend(slot)
    const draws: number[] = []
    const f = d.fixtures.chart!
    const w = d.host.mount(slot, { program: d.prelude + "\n" + f.source, data: f.data, onMetrics: (m: { kind: string }) => m.kind === "draw" && draws.push(1) })
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    await sleep(1500)
    const before = draws.length
    slot.style.width = "0px"
    await sleep(300)
    const zeroStart = draws.length
    w.setTheme("light") // asks every canvas to draw again
    await sleep(800)
    const whileZero = draws.length - zeroStart
    slot.style.width = "420px"
    await sleep(800)
    const after = draws.length - zeroStart - whileZero
    w.destroy()
    slot.remove()
    return { before, whileZero, after }
  })
  check(got.before > 0 && got.whileZero === 0 && got.after > 0, "canvas: no draw while it has zero width; it draws again once sized", got)
  check(errors.length === 0, "zero size: no page errors", errors)
  await page.close()
}

// ---------- minigame (live) ----------
{
  const { page, errors } = await open("?only=minigame")
  const w = widget(page, "minigame")
  await rendered(w)
  await page.waitForTimeout(500)
  const box = (await w.locator("canvas").boundingBox())!
  check((await painted(w))[0]! > 500, "minigame: the ready screen is drawn")
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(1500)
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(box.x + box.width * (0.2 + 0.12 * i), box.y + box.height * (0.35 + 0.08 * (i % 4)))
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(300)
  await shot(w, "minigame")
  check((await painted(w))[0]! > 500, "minigame: frames drawn while playing")
  check(errors.length === 0, "minigame: no page errors", errors)
  await page.close()
}

// ---------- pause out of view ----------
{
  const { page, errors } = await open("?only=clock-demo")
  const w = widget(page, "clock-demo")
  await rendered(w)
  await page.evaluate(() => {
    const spacer = document.createElement("div")
    spacer.style.height = "5000px"
    document.body.append(spacer)
  })
  await page.waitForTimeout(1000)
  const started = Date.now()
  await page.evaluate(() => window.scrollTo(0, 4000))
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
  const texts = await w.locator(".pw-text").allTextContents()
  const running = Number(/running ([\d.]+) s/.exec(texts.join(" "))?.[1])
  const paused = Number(/paused (\d+) ms/.exec(texts.join(" "))?.[1])
  const wall = (Date.now() - started) / 1000 + 1
  check(/resumed 1x/.test(texts.join(" ")) && paused >= 1200, "live: out of view it pauses, and gets { type: resumed, pausedMs } back", texts)
  check(running < wall - 1.1, `live: now() leaves the pause out (running ${running} s of ~${wall.toFixed(1)} s)`)
  await shot(w, "clock-resumed")
  check(errors.length === 0, "clock: no page errors", errors)
  await page.close()
}

// ---------- full screen ----------
{
  const { page, errors } = await open("?only=fullscreen-demo")
  const w = widget(page, "fullscreen-demo")
  await rendered(w)
  const heights = () =>
    w.evaluate((el) =>
      Object.fromEntries(
        [...el.shadowRoot!.querySelectorAll(".pw-surface")].map((s, i) => [["pulse", "echo", "strip"][i]!, Math.round(s.getBoundingClientRect().height)]),
      ),
    )
  const caption = async () => (await w.locator(".pw-caption").textContent()) ?? ""
  const enter = async () => {
    await w.hover()
    await w.locator(".pw-expand").click()
    await page.waitForFunction(() => document.fullscreenElement !== null, undefined, { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(800)
  }
  const inFull = () => page.evaluate(() => document.fullscreenElement !== null)
  const inline = await heights()
  check(inline.pulse === 140 && inline.echo === 80 && inline.strip === 40, "full screen: inline, canvases keep their heights", inline)
  const historyBefore = await page.evaluate(() => history.length)
  await enter()
  const title = await w.locator(".pw-text").first().textContent()
  const full = await heights()
  check((await page.evaluate(() => document.fullscreenElement?.className)) === "psychoscript-widget", "full screen: the widget's element goes full screen")
  check(title?.includes("(full screen)") ?? false, "full screen: onFullscreen gets { type: 'fullscreen', value: true }", title)
  check(
    full.pulse! > 300 && Math.abs(full.pulse! - full.echo!) <= 2 && full.strip === 40,
    "full screen: canvases share the free height equally by default, fill: false keeps its height",
    full,
  )
  // The close button floats over the root's top-right corner: 32 x 32, 8 px from the top and right edges.
  const geo = await w.evaluate((el) => {
    const root = el.shadowRoot!
    const b = (root.querySelector(".pw-expand") as HTMLElement).getBoundingClientRect()
    const node = (root.querySelector(".pw-view") as HTMLElement).firstElementChild!.getBoundingClientRect()
    const pulse = root.querySelector(".pw-surface canvas") as HTMLCanvasElement
    const c = pulse.getBoundingClientRect()
    const scale = pulse.width / c.width
    const px = pulse.getContext("2d")!.getImageData(Math.round((b.left + b.width / 2 - c.left) * scale), Math.round((b.top + b.height / 2 - c.top) * scale), 1, 1).data
    const chrome = [...root.querySelectorAll(".pw-root > :not(.pw-view):not(.pw-expand):not(.pw-hint)")].filter((e) => getComputedStyle(e).display !== "none").length
    return {
      button: { w: b.width, h: b.height, screenTop: Math.round(b.top), screenRight: Math.round(innerWidth - b.right) },
      root: { left: Math.round(node.left), top: Math.round(node.top), right: Math.round(innerWidth - node.right), width: Math.round(node.width) },
      inRoot: [Math.round(b.left - node.left), Math.round(b.top - node.top), b.width, b.height].join(","),
      inPulse: [Math.round(b.left - c.left), Math.round(b.top - c.top), b.width, b.height].join(","),
      pixel: [...px.slice(0, 3)],
      label: el.shadowRoot!.querySelector(".pw-expand")!.getAttribute("aria-label"),
      visible: getComputedStyle(root.querySelector(".pw-expand")!).opacity,
      chrome,
    }
  })
  check(
    geo.button.w === 32 && geo.button.h === 32 && geo.button.screenTop === 8 && geo.button.screenRight === 8 && geo.visible === "1" &&
      geo.label === "Exit full screen" && geo.chrome === 0,
    "full screen: the close button floats 32 x 32, 8 px from the screen's top and right, always visible, the only chrome",
    geo,
  )
  check(
    geo.root.left === 16 && geo.root.top === 16 && geo.root.right === 16,
    "full screen: the root sits inside a 16 px padding, canvases included",
    geo.root,
  )
  check(geo.inRoot === `${geo.root.width - 24},-8,32,32`, `full screen: close is { x: W - 24, y: -8, 32, 32 } in root coordinates (${geo.inRoot})`)
  let text = await caption()
  check(text.includes("· close " + geo.inRoot + " ·"), `full screen: the fullscreen event carries close in root coordinates (${geo.inRoot})`, text)
  check(geo.pixel.join(",") === "255,0,255", "full screen: Frame.close is the button's area on the canvas under it (drawn magenta there)", geo.pixel)
  const pulseBox = (await w.locator(".pw-surface canvas").first().boundingBox())!
  await page.mouse.click(pulseBox.x + pulseBox.width / 2, pulseBox.y + pulseBox.height / 2)
  await page.waitForTimeout(300)
  text = await caption()
  check(text.endsWith("pointer close " + geo.inPulse), `full screen: pointer values from that canvas carry the same close (${geo.inPulse})`, text)
  await shot(page, "fullscreen")
  // Esc closes full screen even while the widget holds the keyboard, and releases it.
  check(await w.evaluate((el) => "focused" in el.dataset), "full screen: the click gave the widget keyboard focus")
  check(
    await w.evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector(".pw-hint")!).display === "none"),
    "full screen: no focus hint over the widget (the close button is the only chrome)",
  )
  await page.keyboard.press("Escape")
  await page.waitForTimeout(600)
  const afterEsc = { full: await inFull(), focused: await w.evaluate((el) => "focused" in el.dataset), text: await caption() }
  check(!afterEsc.full && !afterEsc.focused && afterEsc.text.includes("close none ·"), "full screen: Esc closes it (keyboard focused), releases focus, and leaving sends close: null", afterEsc)
  const back = await heights()
  check(back.pulse === 140 && back.echo === 80 && back.strip === 40, "full screen: leaving it restores the heights", back)
  check(
    (await page.evaluate((k) => history.state?.[k], "psychoscriptWidgetFullscreen")) === undefined,
    "full screen: closing it takes its history entry back off",
  )
  // The browser's back closes it too, whatever holds the keyboard.
  await enter()
  check((await page.evaluate((k) => history.state?.[k] !== undefined, "psychoscriptWidgetFullscreen")) && (await page.evaluate(() => history.length)) > historyBefore, "full screen: entering pushes a history entry")
  await page.mouse.click(pulseBox.x + pulseBox.width / 2, pulseBox.y + 200)
  await page.goBack()
  await page.waitForTimeout(600)
  check(!(await inFull()) && !(await w.evaluate((el) => "focused" in el.dataset)) && page.url().includes("only=fullscreen-demo"), "full screen: the browser's back closes it and releases focus, staying on the page")
  // The close button closes it as well.
  await enter()
  await w.locator(".pw-expand").click()
  await page.waitForTimeout(600)
  check(!(await inFull()), "full screen: the close button closes it")
  check(errors.length === 0, "full screen: no page errors", errors)
  await page.close()
}
{
  // A canvas without any fill prop (the chart) grows in full screen too; the close button takes it back.
  const { page, errors } = await open("?only=chart")
  const w = widget(page, "chart")
  await rendered(w)
  const height = () => w.evaluate((el) => Math.round(el.shadowRoot!.querySelector(".pw-surface")!.getBoundingClientRect().height))
  const before = await height()
  await w.hover()
  await w.locator(".pw-expand").click()
  await page.waitForFunction(() => document.fullscreenElement !== null, undefined, { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(800)
  const grown = await height()
  check(grown > before + 200, `full screen: the chart's canvas fills by default (${before} -> ${grown} px)`)
  await shot(page, "fullscreen-chart")
  await w.locator(".pw-expand").click()
  await page.waitForTimeout(600)
  check((await page.evaluate(() => document.fullscreenElement === null)) && (await height()) === before, "full screen: the close button exits and the canvas is back to its height")
  check(errors.length === 0, "full screen (chart): no page errors", errors)
  await page.close()
}

// ---------- slice budget ----------
{
  const { page, errors } = await open("?only=runaway-demo")
  const w = widget(page, "runaway-demo")
  await rendered(w)
  await w.locator("button.pw-btn", { hasText: "Spin" }).click()
  const error = w.locator(".pw-error")
  await error.waitFor({ timeout: 5000 }).catch(() => {})
  const text = (await error.textContent()) ?? ""
  check(/more than 50 ms without waiting/.test(text), "live: a run computing over 50 ms without awaiting is stopped", text)
  await shot(w, "slice-budget")
  await w.locator(".pw-error button", { hasText: "Restart" }).click()
  await w.locator("button.pw-btn", { hasText: "Spin" }).waitFor({ timeout: 5000 })
  check(await error.isHidden(), "live: Restart starts it again")
  const sliced = (await log(page)).filter((l) => l.startsWith("runaway-demo report"))
  check(sliced.length === 1 && /"phase":"main".*50 ms/.test(sliced[0]!), "failures: the slice budget is a program error (phase main)", sliced)
  check(errors.length === 0, "runaway: no page errors", errors)
  await page.close()
}

// ---------- fetch rules ----------
{
  const { page, errors } = await open("?only=fetch-demo")
  const w = widget(page, "fetch-demo")
  await rendered(w)
  check((await w.locator(".pw-chip").textContent()) === "Network: api.github.com", "fetch: the capability chip shows the declared host")
  const lines = async () => (await w.locator(".pw-text").allTextContents()).join(" | ")
  const until = async (re: RegExp) => {
    const end = Date.now() + 16000
    while (Date.now() < end && !re.test(await lines())) await page.waitForTimeout(100)
    return lines()
  }
  const first = await until(/status \d+|Network:|Timeout:/)
  check(/status 200/.test(first) || /Network:/.test(first), "fetch: an allowed host goes through the browser (200, or Network without connectivity)", first)
  await w.locator("button.pw-btn", { hasText: "localhost" }).click()
  const local = await until(/http:\/\/localhost[\s\S]*CapabilityDenied/)
  check(/CapabilityDenied: only https/.test(local), "fetch: http: is denied", local)
  await w.locator("button.pw-btn", { hasText: "example.com" }).click()
  const other = await until(/example\.com[\s\S]*CapabilityDenied/)
  check(/isn't among the hosts/.test(other), "fetch: an undeclared host is denied", other)
  check(!(await log(page)).some((l) => / report /.test(l)), "failures: fetch errors the program handles are never reported")
  await shot(w, "fetch")
  check(errors.length === 0, "fetch: no page errors", errors)
  await page.close()
}

// ---------- the wheel (widgets-input.md, Wheel): delivered only under pointer capture ----------
{
  const { page, errors } = await open("?only=confirm", { width: 800, height: 600 })
  const live = `async function main() {
  let wheels = 0, dx = 0, dy = 0, keys = ""
  const show = () => widget.render(ui.column([
    ui.canvas({ height: 120, onPointer: (p) => {
      if (p.kind === "down") widget.capturePointer()
      if (p.kind === "wheel") { wheels++; dx += p.dx; dy += p.dy; keys = Object.keys(p).join(); show() }
    } }),
    ui.text("wheels " + wheels + " dx " + dx + " dy " + dy + " keys " + keys),
  ]))
  show()
  await widget.sleep(100000)
}`
  await page.evaluate((source) => {
    const d = (window as unknown as { __demo: { host: { mount(el: HTMLElement, o: object): unknown }; program(s: string, m: string): string } }).__demo
    document.body.style.minHeight = "4000px"
    const slot = document.createElement("div")
    slot.id = "wheel-slot"
    slot.style.cssText = "position:absolute;left:0;top:0;width:400px;z-index:9999;background:#fff"
    document.body.prepend(slot)
    d.host.mount(slot, { program: d.program(source, "live"), data: null, mode: "live" })
  }, live)
  await page.waitForTimeout(1500)
  const root = page.locator("#wheel-slot .psychoscript-widget")
  const text = async () => (await root.locator(".pw-text").allTextContents()).join(" | ")
  const scrollY = () => page.evaluate(() => window.scrollY)
  const c = (await root.locator(".pw-surface canvas").boundingBox())!
  // Wheel events dispatched in one task, at the canvas (none under capture: the document's listener takes them).
  const wheel = (events: Array<{ deltaX: number; deltaY: number; deltaMode: number }>) =>
    root.evaluate((el, events) => {
      const canvas = el.shadowRoot!.querySelector(".pw-surface canvas")!
      const r = canvas.getBoundingClientRect()
      return events.map((e) => canvas.dispatchEvent(new WheelEvent("wheel", { ...e, clientX: r.x + 10, clientY: r.y + 10, bubbles: true, cancelable: true, composed: true })))
    }, events)

  // Without capture: never delivered, never prevented; the page scrolls over a canvas that takes pointer input too.
  const free = await wheel([{ deltaX: 0, deltaY: 40, deltaMode: 0 }])
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(500)
  const uncaptured = { prevented: free.some((k) => !k), scrollY: await scrollY(), text: await text() }
  check(
    !uncaptured.prevented && uncaptured.scrollY > 0 && /wheels 0 /.test(uncaptured.text),
    "wheel: without pointer capture it is never delivered nor prevented: the page scrolls, over a canvas with pointer too",
    uncaptured,
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)

  // Under capture: { kind: wheel, dx, dy } where captured moves go, summed into one delivery a frame, prevented.
  const box = (await root.locator(".pw-surface canvas").boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  const locked = await page.evaluate(() => document.pointerLockElement !== null)
  const kept = await wheel([
    { deltaX: 10, deltaY: 40, deltaMode: 0 },
    { deltaX: 10, deltaY: 40, deltaMode: 0 },
    { deltaX: 10, deltaY: 40, deltaMode: 0 },
  ])
  await page.waitForTimeout(500)
  const summed = await text()
  check(
    locked && kept.every((k) => k === false) && /wheels 1 dx 30 dy 120 keys kind,dx,dy/.test(summed),
    "wheel: under pointer capture it is { kind: wheel, dx, dy }, a frame's events summed into one delivery; prevented",
    { locked, kept, summed },
  )
  await wheel([{ deltaX: 0, deltaY: 3, deltaMode: 1 }])
  await page.waitForTimeout(400)
  const lines = await text()
  await wheel([{ deltaX: 1, deltaY: -1, deltaMode: 2 }])
  await page.waitForTimeout(400)
  const pages = await text()
  check(
    /wheels 2 dx 30 dy 240 /.test(lines) && new RegExp(`wheels 3 dx ${30 + Math.round(box.width)} dy ${240 - Math.round(box.height)} `).test(pages),
    "wheel: lines are 40 px, pages the canvas's logical height (its width for dx)",
    { lines, pages, width: box.width, height: box.height },
  )
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(500)
  const real = { scrollY: await scrollY(), text: await text() }
  check(real.scrollY === 0 && /wheels 4 /.test(real.text), "wheel: under pointer capture a real wheel is delivered and the page doesn't scroll", real)
  // Released: the listener goes; the page scrolls again and nothing is delivered.
  await page.keyboard.press("Escape")
  await page.waitForTimeout(400)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(500)
  const released = { locked: await page.evaluate(() => document.pointerLockElement !== null), scrollY: await scrollY(), text: await text() }
  check(!released.locked && released.scrollY > 0 && /wheels 4 /.test(released.text), "wheel: once capture ends, the page scrolls again and nothing is delivered", released)
  check(errors.length === 0, "wheel: no page errors", errors)
  await page.close()
}

// ---------- keyboard focus and pointer capture ----------
{
  const { page, errors } = await open("?only=keys-demo")
  const w = widget(page, "keys-demo")
  await rendered(w)
  await page.evaluate(() => {
    const spacer = document.createElement("div")
    spacer.style.height = "3000px"
    document.body.append(spacer)
  })
  const text = async () => (await w.locator(".pw-text").allTextContents()).join(" | ")
  const until = async (re: RegExp, ms = 3000) => {
    const end = Date.now() + ms
    let t = await text()
    while (Date.now() < end && !re.test(t)) {
      await page.waitForTimeout(50)
      t = await text()
    }
    return t
  }
  const hint = () => w.evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector(".pw-hint")!).display !== "none")
  const pad = (await w.locator("canvas").boundingBox())!
  // Hover: moves over a canvas with an id and no button held, at most one a frame.
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(pad.x + 30 + i * 40, pad.y + pad.height / 2)
    await page.waitForTimeout(60)
  }
  let t = await until(/hover [3-9]/)
  const hovered = Number(/hover (\d+)/.exec(t)?.[1] ?? 0)
  check(hovered >= 3 && hovered <= 5, `hover: moves with down: false reach update without a button held (${hovered} for 5 moves)`, t)
  // 40 moves in one task (Chromium already aligns real input to frames, so send them at once).
  await w.evaluate((el) => {
    const c = el.shadowRoot!.querySelector("canvas")!
    const r = c.getBoundingClientRect()
    for (let i = 0; i < 40; i++)
      c.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + 20 + i * 5, clientY: r.top + 30, pointerType: "mouse", bubbles: true, composed: true }))
  })
  await page.waitForTimeout(300)
  const burst = Number(/hover (\d+)/.exec(await text())?.[1] ?? 0) - hovered
  check(burst === 1, `hover: at most one a frame (${burst} sent for 40 moves in one frame)`)
  await page.mouse.click(pad.x + pad.width / 2, pad.y + pad.height / 2)
  t = await until(/focus true/)
  check(/focus true/.test(t), "keys: a click inside gives the widget keyboard focus ({ type: focus, value: true })", t)
  check((await hint()) && (await w.evaluate((el) => "focused" in el.dataset)), "keys: focus ring and the Esc-to-release hint show")
  const hintShape = () =>
    w.evaluate((el) => {
      const h = el.shadowRoot!.querySelector(".pw-hint") as HTMLElement
      return { mode: h.dataset.mode, icon: h.querySelector("svg") !== null, text: h.textContent, label: h.getAttribute("aria-label") }
    })
  const focusedHint = await hintShape()
  check(focusedHint.mode === "keyboard" && focusedHint.icon && focusedHint.text === "Esc", "keys: the hint is a keyboard icon plus Esc", focusedHint)
  const scrolled = await page.evaluate(() => window.scrollY)
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("x")
  t = await until(/last up x · keys 4/)
  check(/last up x · keys 4/.test(t), "keys: down and up reach update, with key and code", t)
  check((await page.evaluate(() => window.scrollY)) === scrolled, "keys: the page doesn't scroll on the widget's arrow keys")
  const slot = page.locator('.slot[data-name="keys-demo"]')
  await shot(slot, "keys-focused")
  await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a")
  await page.waitForTimeout(300)
  check(/keys 4/.test(await text()), "keys: Cmd/Ctrl chords go to the page, not the widget")
  // The chord was the page's select-all: clear it for the screenshots.
  await page.evaluate(() => getSelection()?.removeAllRanges())
  await page.keyboard.press("Escape")
  t = await until(/focus false/)
  check(/focus false/.test(t) && /keys 4/.test(t), "keys: Esc releases focus and is never delivered", t)
  check(!(await hint()), "keys: the hint goes with the focus")
  await w.focus()
  t = await until(/focus true/)
  check(/focus true/.test(t), "keys: tabbing to the widget (focus) gives it the keyboard too", t)
  await page.keyboard.press("Escape")
  await until(/focus false/)

  // Pointer capture: the root asks with capture: "pointer"; the next click grants it.
  await w.locator("button.pw-btn", { hasText: "Ask for the mouse" }).click()
  await w.locator("button.pw-btn", { hasText: "Stop asking" }).waitFor({ timeout: 3000 })
  const locked = () => w.evaluate((el) => document.pointerLockElement === el)
  check(!(await locked()), "capture: not granted before the next click")
  await page.mouse.click(pad.x + pad.width / 2, pad.y + pad.height / 2)
  t = await until(/captured true/)
  check((await locked()) && /captured true/.test(t), "capture: the next click locks the pointer ({ type: capture, value: true })", t)
  const capturedHint = await hintShape()
  check(capturedHint.mode === "pointer" && capturedHint.icon && capturedHint.text === "Esc", "capture: the hint turns into a cursor icon plus Esc", capturedHint)
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(pad.x + pad.width / 2 + i * 12, pad.y + pad.height / 2 + i * 3)
    await page.waitForTimeout(40)
  }
  await page.mouse.down()
  await page.mouse.up()
  t = await until(/buttons 2/)
  const moved = Number(/moved (\d+)/.exec(t)?.[1] ?? 0)
  check(moved > 0 && /buttons 2/.test(t), `capture: relative moves (dx, dy) and buttons reach the program (moved ${moved})`, t)
  await shot(slot, "keys-captured")
  await page.keyboard.press("Escape")
  t = await until(/focus false · captured false/)
  check(!(await locked()) && /focus false · captured false/.test(t), "capture: one Esc releases the pointer and the keyboard", t)
  check(errors.length === 0, "keys: no page errors", errors)
  await page.close()
}
{
  const { page, errors } = await open("?only=keys-live")
  const w = widget(page, "keys-live")
  await rendered(w)
  const text = async () => (await w.locator(".pw-text").allTextContents()).join(" | ")
  const until = async (re: RegExp) => {
    const end = Date.now() + 3000
    let t = await text()
    while (Date.now() < end && !re.test(t)) {
      await page.waitForTimeout(50)
      t = await text()
    }
    return t
  }
  const pad = (await w.locator("canvas").boundingBox())!
  await page.mouse.click(pad.x + 20, pad.y + pad.height / 2)
  await until(/focus true/)
  await page.keyboard.press("k")
  let t = await until(/last up k/)
  check(/focus true/.test(t) && /last up k · keys 2/.test(t), "keys (live): focus and keys reach widget.event()", t)
  await w.locator("button.pw-btn", { hasText: "Capture the mouse" }).click()
  await page.waitForTimeout(200)
  await page.mouse.click(pad.x + 40, pad.y + pad.height / 2)
  t = await until(/captured true/)
  check(/captured true/.test(t), "capture (live): capturePointer() is granted on the next click", t)
  await page.keyboard.press("Escape")
  t = await until(/focus false · captured false/)
  check(/focus false · captured false/.test(t), "capture (live): Esc releases both", t)
  check(errors.length === 0, "keys (live): no page errors", errors)
  await page.close()
}

// ---------- failures: program vs client errors, reports, Ask agent to fix it ----------
for (const query of ["?only=broken-demo", "?only=broken-demo&nosource=1"]) {
  const { page, errors } = await open(query)
  const w = widget(page, "broken-demo")
  await rendered(w)
  await w.locator("button.pw-btn", { hasText: "Break it" }).click()
  const line = await waitLog(page, (l) => l.startsWith("broken-demo report"))
  const report = line ? JSON.parse(line.slice("broken-demo report ".length)) : undefined
  check(
    report?.phase === "event" &&
      /TypeError/.test(report?.message) &&
      !/\(line \d+/.test(report?.message) &&
      report?.line === 4 &&
      typeof report?.column === "number",
    `failures: a handler's exception is reported once, with its widget-template-relative position${query.includes("nosource") ? " (prelude found without source)" : ""}`,
    report,
  )
  check(/\(line 4/.test((await w.locator(".pw-error").textContent()) ?? ""), "failures: the inline error shows the widget template's line too")
  const failure = w.locator(".pw-failure")
  const ask = failure.locator("button", { hasText: "Ask agent to fix it" })
  await ask.waitFor({ timeout: 3000 }).catch(() => {})
  check(await ask.isVisible(), "failures: a failure with sent: false offers Ask agent to fix it")
  check((await failure.locator(".pw-failure-text").count()) === 0, "failures: the failure's text isn't repeated under the same local error")
  await w.locator("button.pw-btn", { hasText: "Break it" }).click()
  await page.waitForTimeout(300)
  check((await log(page)).filter((l) => l.startsWith("broken-demo report")).length === 1, "failures: the same error isn't reported twice")
  await ask.click()
  const asked = await waitLog(page, (l) => l.startsWith("broken-demo ask"))
  check(asked !== undefined && asked.slice("broken-demo ask ".length) === JSON.stringify(report), "failures: Ask calls the embedder's onAsk with the same error", asked)
  await failure.locator(".pw-failure-told").waitFor({ timeout: 3000 }).catch(() => {})
  check(
    (await failure.locator(".pw-failure-told").textContent()) === "The agent was told about this error." && (await ask.count()) === 0,
    "failures: with sent: true it says the agent was told",
  )
  if (!query.includes("nosource")) await shot(page.locator('.slot[data-name="broken-demo"]'), "failure-told")
  check(!(await log(page)).some((l) => / client-error /.test(l)), "failures: a program error is no client error")
  check(errors.length === 0, "failures: no page errors", errors)
  await page.close()
}
{
  // An artifact (no agent session): no ask handler, so a failure shows without the button.
  const { page, errors } = await open("?only=broken-demo&noask=1")
  const w = widget(page, "broken-demo")
  await rendered(w)
  await page.evaluate(() =>
    (window as unknown as { __demo: { widgets: Record<string, { setFailure(f: unknown): void }> } }).__demo.widgets["broken-demo"]!.setFailure({
      phase: "init",
      message: "ReferenceError: boom is not defined",
      line: 2,
      column: 9,
      client: "tui",
      sent: false,
    }),
  )
  const failure = w.locator(".pw-failure")
  const text = (await failure.locator(".pw-failure-text").textContent()) ?? ""
  check(text === "Failed on tui: init: ReferenceError: boom is not defined (line 2, col 9)", "failures: another client's failure shows as Failed on <client>: <phase>: <message> (line:col)", text)
  check((await failure.locator("button").count()) === 0, "failures: without onAsk (an artifact) there's no Ask button")
  await shot(page.locator('.slot[data-name="broken-demo"]'), "failure-artifact")
  check(errors.length === 0, "failures (artifact): no page errors", errors)
  await page.close()
}
for (const query of ["?only=shader-broken"]) {
  const { page, errors } = await open(query)
  const w = widget(page, "shader-broken")
  await rendered(w)
  const line = await waitLog(page, (l) => l.startsWith("shader-broken report"), 8000)
  const report = line ? JSON.parse(line.slice("shader-broken report ".length)) : undefined
  check(
    report?.phase === "shader" && /WGSL line 2/.test(report?.message) && report?.line === undefined,
    "failures: WGSL that fails validation is a program error (WebGPU)",
    report,
  )
  check(errors.length === 0, "failures (shader): no page errors", errors)
  await page.close()
}
{
  // A host that can't start its worker: a client error for the dev log, never a report.
  const { page } = await open("?only=confirm")
  const got = await page.evaluate(async () => {
    const d = (window as unknown as { __demo: { WidgetHost: new (o: object) => { mount(el: HTMLElement, o: object): { destroy(): void }; destroy(): void }; fixtures: Record<string, { source: string; data: unknown }> } }).__demo
    const slot = document.createElement("div")
    document.body.prepend(slot)
    const reports: unknown[] = []
    const clientErrors: string[] = []
    const host = new d.WidgetHost({ workerUrl: "/no-such-worker.js" })
    host.mount(slot, {
      program: "const __widget_protocol = 2\nfunction view() { return ui.text('x') }",
      data: {},
      onReport: (e: unknown) => reports.push(e),
      onClientError: (m: string) => clientErrors.push(m),
    })
    await new Promise((r) => setTimeout(r, 2500))
    host.destroy()
    return { reports, clientErrors }
  })
  check(got.reports.length === 0 && got.clientErrors.length > 0, "failures: a host failure (no worker) goes to onClientError, not onReport", got)
  await page.close()
}

// ---------- widget protocol 2: the protocol check, rules of views, functions where none may go ----------
{
  const { page, errors } = await open("?only=confirm")
  const got = await page.evaluate(async () => {
    const d = (window as unknown as { __demo: { host: { mount(el: HTMLElement, o: object): { destroy(): void } }; prelude: string; program(source: string, mode: string): string } }).__demo
    const older = d.prelude.slice(d.prelude.indexOf("\n") + 1)
    const run = async (name: string, given: string | { source: string }, mode: string, act?: (root: ShadowRoot) => void, extra?: object) => {
      const program = typeof given === "string" ? given : d.program(given.source, mode)
      const slot = document.createElement("div")
      document.body.prepend(slot)
      const reports: { phase: string; message: string; line?: number }[] = []
      const clientErrors: string[] = []
      const w = d.host.mount(slot, { program, data: null, mode, ...extra, onReport: (e: { phase: string; message: string; line?: number }) => reports.push(e), onClientError: (m: string) => clientErrors.push(m) })
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      await sleep(1200)
      const root = slot.querySelector(".psychoscript-widget")!.shadowRoot!
      if (act) {
        act(root)
        await sleep(800)
      }
      const out = { name, reports, clientErrors, shown: (root.querySelector(".pw-error-card, .pw-error:not([hidden])") as HTMLElement | null)?.textContent ?? "", buttons: root.querySelectorAll(".pw-view .pw-btn").length, text: root.querySelector(".pw-view .pw-text")?.textContent ?? "", retry: root.querySelectorAll(".pw-error-card .pw-btn").length }
      w.destroy()
      slot.remove()
      return out
    }
    // A widget template's source, served as the program of its mode.
    const step = (source: string) => ({ source })
    return [
      await run("older", older + "\nfunction view() { return ui.text('x') }", "step"),
      await run("older-live", older + "\nasync function main() { widget.render(ui.text('x')) }", "live"),
      await run("newer", "const __widget_protocol = 3\nfunction view() { return ui.text('x') }", "step"),
      await run("older-shared", older + "\nfunction view() { return ui.text('x') }", "step", undefined, {
        olderRuntimeMessage: "This artifact was shared with an older widget runtime; share it again from its widget template.",
      }),
      await run(
        "key",
        step(`function view(state) {\n  return ui.column([ui.button("b", { key: state.bad ? { a: 1 } : "k", onPress: () => ({ bad: true }) })])\n}`),
        "step",
        (root) => (root.querySelector(".pw-view .pw-btn") as HTMLElement).click(),
      ),
      await run("step-100", step(`function view() {\n  let node = ui.button("deep", { onPress: (s) => s })\n  for (let i = 1; i < 100; i++) node = ui.column([node])\n  return node\n}`), "step"),
      await run("step-101", step(`function view() {\n  let node = ui.button("deep", { onPress: (s) => s })\n  for (let i = 1; i < 101; i++) node = ui.column([node])\n  return node\n}`), "step"),
      await run("live-100", step(`async function main() {\n  let node = ui.button("deep", { onPress: () => {} })\n  for (let i = 1; i < 100; i++) node = ui.column([node])\n  widget.render(node)\n}`), "live"),
      await run("step-draw", step(`function view() {\n  return ui.canvas({ key: "c", height: 20 })\n}\nfunction draw() {\n  return [["save"], ["text", 0, 10, "t", { weight: 800 }]]\n}`), "step"),
      await run("caught", step(`async function main() {\n  try { widget.send({ f: () => 1 }) } catch (e) {\n    widget.render(ui.text([e instanceof TypeError, e.name, e.message].join(" | ")))\n  }\n}`), "live"),
      await run("async", step(`async function main() {\n  await __host.sleep(() => 1)\n}`), "live"),
      await run("deep", step(`async function main() {\n  let node = ui.text("x")\n  for (let i = 1; i < 101; i++) node = ui.column([node])\n  widget.render(node)\n}`), "live"),
      await run("function", step(`function view() {\n  return ui.column({ onHover: (s) => s }, [ui.text("t")])\n}`), "step"),
    ]
  })
  const by = Object.fromEntries(got.map((g) => [g.name, g]))
  const OLDER = "This widget was built with an older widget runtime; ask the agent to post it again"
  const NEWER = "This widget needs a newer version of this app"
  check(
    JSON.stringify(by.older!.reports) === JSON.stringify([{ phase: "init", message: OLDER }]) && by.older!.shown === OLDER && by.older!.retry === 0,
    "protocol: a program without `const __widget_protocol = 2` isn't run: the older-runtime error, reported in phase init, no Try again",
    by.older,
  )
  check(JSON.stringify(by["older-live"]!.reports) === JSON.stringify([{ phase: "main", message: OLDER }]), "protocol: an older live program is refused in phase main", by["older-live"])
  check(
    by.newer!.reports.length === 0 && by.newer!.clientErrors.includes(NEWER) && by.newer!.shown === NEWER && by.newer!.retry === 0,
    "protocol: a newer program shows the newer-app message, no Try again, a client error, never reported",
    by.newer,
  )
  check(
    by["older-shared"]!.shown === "This artifact was shared with an older widget runtime; share it again from its widget template." &&
      JSON.stringify(by["older-shared"]!.reports) === JSON.stringify([{ phase: "init", message: OLDER }]) &&
      by["older-shared"]!.retry === 0,
    "protocol: olderRuntimeMessage replaces the older-runtime text shown; the report keeps the spec's message",
    by["older-shared"],
  )
  check(
    JSON.stringify(by.key!.reports) === JSON.stringify([{ phase: "view", message: "A node's key must be a string, a number or a boolean" }]) && by.key!.buttons === 1,
    "rules of views: a key of another type fails the step in phase view, the view kept",
    by.key,
  )
  check(JSON.stringify(by.deep!.reports) === JSON.stringify([{ phase: "view", message: "The view nests more than 100 levels" }]), "rules of views: a live view over 100 levels ends the run in phase view", by.deep)
  check(by["step-100"]!.reports.length === 0 && by["step-100"]!.buttons === 1, "rules of views: a step view of 100 levels crosses (depth 202) and renders", by["step-100"])
  check(by["live-100"]!.reports.length === 0 && by["live-100"]!.buttons === 1, "rules of views: a live view of 100 levels renders", by["live-100"])
  check(
    JSON.stringify(by["step-101"]!.reports) === JSON.stringify([{ phase: "view", message: "The view nests more than 100 levels" }]) && by["step-101"]!.shown.startsWith("The view nests more than 100 levels"),
    "rules of views: a step view of 101 levels fails in phase view with the spec's message",
    by["step-101"],
  )
  check(
    JSON.stringify(by.function!.reports) === JSON.stringify([{ phase: "init", message: "TypeError: Argument 1 to __widget_emit contains a function, which cannot be passed to the host." }]),
    "functions: a function in a view's prop fails the step with the runtime's TypeError",
    by.function,
  )
  check(
    by.caught!.text === "true | TypeError | Argument 1 to __host.post contains a function, which cannot be passed to the host." && by.caught!.reports.length === 0,
    "functions: a program that catches the error sees a real TypeError",
    by.caught,
  )
  check(
    JSON.stringify(by.async!.reports) ===
      JSON.stringify([{ phase: "main", message: "TypeError: Argument 1 to __host.sleep contains a function, which cannot be passed to the host.", line: 2, column: 9 }]),
    "functions: an async host call's error is located at the call (line 2 of the widget template)",
    by.async,
  )
  check(
    JSON.stringify(by["step-draw"]!.reports) === JSON.stringify([{ phase: "draw", message: "draw command 1: a text weight must be 400, 500, 600 or 700" }]),
    "draw checks: a draw step with an invalid command fails in phase draw, named by its index",
    by["step-draw"],
  )
  check(errors.length === 0, "protocol 2: no page errors", errors)
  await page.close()
}

// ---------- live post rate: renders and draws wait and coalesce, frames always get through ----------
{
  const { page, errors } = await open("?only=confirm")
  const got = await page.evaluate(async () => {
    const d = (window as unknown as { __demo: { host: { mount(el: HTMLElement, o: object): { destroy(): void } }; prelude: string; program(source: string, mode: string): string } }).__demo
    const run = async (name: string, source: string, done: (text: string) => boolean) => {
      const slot = document.createElement("div")
      document.body.prepend(slot)
      const reports: { phase: string; message: string }[] = []
      const warnings: string[] = []
      let submitted: unknown
      const started = performance.now()
      const w = d.host.mount(slot, {
        program: d.program(source, "live"),
        data: null,
        mode: "live",
        onReport: (e: { phase: string; message: string }) => reports.push(e),
        onWarning: (m: string) => warnings.push(m),
        onSubmit: (v: unknown) => (submitted = v),
      })
      const root = () => slot.querySelector(".psychoscript-widget")!.shadowRoot!
      const text = () => [...root().querySelectorAll(".pw-view .pw-text")].map((t) => t.textContent).join(" | ")
      while (performance.now() - started < 10000 && !done(text()) && reports.length === 0) await new Promise((r) => setTimeout(r, 20))
      await new Promise((r) => setTimeout(r, 300))
      const out = { name, text: text(), reports, warnings, submitted, ms: Math.round(performance.now() - started) }
      w.destroy()
      slot.remove()
      return out
    }
    return [
      // 300 renders at once, over the 240 a second: the last one shows, nothing is reported, the answer comes after it.
      await run("burst", `async function main() {\n  for (let i = 0; i < 300; i++) widget.render(ui.text("render " + i))\n  widget.submit(1)\n}`, (t) => t === "render 299"),
      // 300 draws over two canvases, then a frame: the frame request isn't held behind them.
      await run(
        "draws",
        `async function main() {\n  widget.render(ui.column([ui.canvas({ key: "a", height: 4 }), ui.canvas({ key: "b", height: 4 })]))\n  for (let i = 0; i < 150; i++) { widget.draw("a", [["alpha", i / 1000]]); widget.draw("b", [["alpha", i / 500]]) }\n  const frame = await widget.frame()\n  widget.render(ui.text("frame " + (frame.t >= 0)))\n  await widget.sleep(100000)\n}`,
        (t) => t === "frame true",
      ),
      // A game posting a render and two draws a frame for 120 frames: every frame comes, the last view shows.
      await run(
        "game",
        `async function main() {\n  for (let n = 0; n < 120; n++) {\n    await widget.frame()\n    widget.render(ui.column([ui.text("n " + n), ui.canvas({ key: "a", height: 4 }), ui.canvas({ key: "b", height: 4 })]))\n    widget.draw("a", [["alpha", n / 1000]])\n    widget.draw("b", [["alpha", n / 200]])\n  }\n  await widget.sleep(100000)\n}`,
        (t) => t === "n 119",
      ),
      await run("oversized", `async function main() {\n  widget.render(ui.canvas({ key: "c", height: 4 }))\n  widget.draw("c", Array.from({ length: 2001 }, () => ["save"]))\n}`, () => false),
      await run("invalid", `async function main() {\n  widget.render(ui.canvas({ key: "c", height: 4 }))\n  widget.draw("c", [["save"], ["blur", 1]])\n}`, () => false),
      await run("keyless", `async function main() {\n  widget.render(ui.canvas({ key: "c", height: 4 }))\n  __host.post({ type: "draw", id: "0", commands: [] })\n}`, () => false),
    ]
  })
  const by = Object.fromEntries(got.map((g) => [g.name, g]))
  check(by.burst!.text === "render 299" && by.burst!.submitted === 1 && by.burst!.reports.length === 0 && by.burst!.warnings.length === 0, "post rate: 300 renders at once show the last one, then the answer; no error, no warning", by.burst)
  check(by.draws!.text === "frame true" && by.draws!.reports.length === 0, "post rate: a frame request under a load of draws is answered", by.draws)
  check(by.game!.text === "n 119" && by.game!.reports.length === 0, `post rate: a game posting three times a frame runs all 120 frames (${by.game!.ms} ms) and shows its last view`, by.game)
  check(JSON.stringify(by.keyless!.reports) === JSON.stringify([{ phase: "main", message: "A draw post needs a string key" }]), "post rate: a draw post without a string key ends the run, reported in phase main", by.keyless)
  check(
    JSON.stringify(by.oversized!.reports) === JSON.stringify([{ phase: "draw", message: "2001 draw commands is over the budget of 2000 per frame" }]),
    "draw posts: one over 2,000 commands ends the run, reported in phase draw",
    by.oversized,
  )
  check(
    JSON.stringify(by.invalid!.reports) === JSON.stringify([{ phase: "draw", message: 'draw command 1: unknown draw command "blur"' }]),
    "draw posts: an invalid command ends the run in phase draw, named by its index",
    by.invalid,
  )
  check(errors.length === 0, "post rate: no page errors", errors)
  await page.close()
}

// ---------- GPU canvases (widgets-gpu.md): widget.gpu batches replayed on WebGPU, pixels read back ----------
{
  const gpu = await import("./gpu-programs.ts")
  /** Mounts a live program at the top-left of the page for `ms`; its GPU canvas's rect and what it shows. */
  const mount = async (page: Page, source: string, ms = 1500, data: unknown = null, width = 320) =>
    page.evaluate(
      async ([source, ms, data, width]) => {
        const d = (window as unknown as { __demo: { host: { mount(el: HTMLElement, o: object): { destroy(): void } }; program(source: string, mode: string): string } }).__demo
        const slot = document.createElement("div")
        slot.style.cssText = `position:fixed;left:0;top:0;width:${width}px;z-index:9999;background:#fff`
        document.body.prepend(slot)
        const g = { reports: [] as { phase: string; message: string }[], clientErrors: [] as string[], gpuMs: [] as number[], slot, w: undefined as unknown }
        g.w = d.host.mount(slot, {
          program: d.program(source as string, "live"),
          data,
          mode: "live",
          onReport: (e: { phase: string; message: string }) => g.reports.push(e),
          onClientError: (m: string) => g.clientErrors.push(m),
          onMetrics: (m: { kind: string; ms: number }) => m.kind === "gpu" && g.gpuMs.push(m.ms),
        })
        ;(window as unknown as { __gpu: unknown }).__gpu = g
        await new Promise((r) => setTimeout(r, ms as number))
      },
      [source, ms, data, width] as const,
    )
  const state = (page: Page) =>
    page.evaluate(() => {
      const g = (window as unknown as { __gpu: { slot: HTMLElement; reports: unknown[]; clientErrors: string[]; gpuMs: number[] } }).__gpu
      const root = g.slot.querySelector(".psychoscript-widget")!.shadowRoot!
      const c = root.querySelector('.pw-surface[data-kind="webgpu"] canvas') as HTMLCanvasElement | null
      const r = c?.getBoundingClientRect()
      return {
        rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
        size: c ? [c.width, c.height] : null,
        reports: g.reports,
        clientErrors: g.clientErrors,
        batches: g.gpuMs.length,
        gpuMs: g.gpuMs,
        alt: root.querySelector(".pw-surface .pw-alt")?.textContent ?? "",
        text: [...root.querySelectorAll(".pw-text")].map((t) => t.textContent ?? ""),
      }
    })
  /** The canvas as on screen: its PNG, and its pixels at (x, y) fractions. */
  const pixels = async (page: Page, rect: { x: number; y: number; width: number; height: number }, at: [number, number][]) => {
    const png = await page.screenshot({ clip: rect })
    const px = await page.evaluate(
      async ([bytes, at]) => {
        const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes as number[])], { type: "image/png" }))
        const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!
        g.drawImage(bmp, 0, 0)
        return (at as [number, number][]).map(([x, y]) => [...g.getImageData(Math.floor(x * bmp.width), Math.floor(y * bmp.height), 1, 1).data].slice(0, 3))
      },
      [[...png], at] as const,
    )
    return { png, px }
  }
  const done = (page: Page) =>
    page.evaluate(() => {
      const g = (window as unknown as { __gpu: { w: { destroy(): void }; slot: HTMLElement } }).__gpu
      g.w.destroy()
      g.slot.remove()
    })
  const near = (p: number[] | undefined, want: number[], d = 8) => !!p && p.every((v, i) => Math.abs(v - want[i]!) <= d)
  const lit = (p: number[] | undefined) => !!p && p.some((v) => v > 40)
  const CORNERS: [number, number][] = [[0.5, 0.5], [0.03, 0.03], [0.5, 0.1]]
  // The small canvases' corners are rounded off: their outside is sampled at the left edge's middle.
  const EDGE: [number, number][] = [[0.5, 0.5], [0.04, 0.5], [0.5, 0.1]]
  const { page, errors } = await open("?only=confirm", { width: 800, height: 600 })
  // The host's copies to a canvas (a kept texture presented) and the usages contexts are configured with.
  await page.addInitScript(() => {
    const w = window as unknown as { __copies: number; __usages: number[] }
    w.__copies = 0
    w.__usages = []
    const copy = GPUCommandEncoder.prototype.copyTextureToTexture
    GPUCommandEncoder.prototype.copyTextureToTexture = function (this: GPUCommandEncoder, ...args: Parameters<typeof copy>) {
      w.__copies++
      return copy.apply(this, args)
    }
    const configure = GPUCanvasContext.prototype.configure
    GPUCanvasContext.prototype.configure = function (this: GPUCanvasContext, c: GPUCanvasConfiguration) {
      w.__usages.push(c.usage ?? GPUTextureUsage.RENDER_ATTACHMENT)
      return configure.call(this, c)
    }
  })
  await page.reload()
  const copies = () =>
    page.evaluate(() => {
      const w = window as unknown as { __copies: number; __usages: number[] }
      const got = { copies: w.__copies, usages: w.__usages }
      w.__copies = 0
      w.__usages = []
      return got
    })

  await mount(page, gpu.clear)
  const clear = await state(page)
  const clearPx = (await pixels(page, clear.rect!, EDGE)).px
  check(clearPx.every((p) => near(p, [255, 0, 0])) && clear.reports.length === 0, "gpu: a render pass clears the canvas to red", { ...clear, clearPx })
  await done(page)
  await mount(page, gpu.triangle)
  const triangle = await state(page)
  const triPx = (await pixels(page, triangle.rect!, EDGE)).px
  check(near(triPx[0], [0, 255, 0]) && near(triPx[1], [0, 0, 0]) && triangle.reports.length === 0, "gpu: a pipeline draws a green triangle on black", { ...triangle, triPx })
  await done(page)
  await mount(page, gpu.cube)
  const cube = await state(page)
  const cubePx = (await pixels(page, cube.rect!, EDGE)).px
  check(
    near(cubePx[0], [255, 0, 0]) && near(cubePx[1], [0, 0, 0]) && cube.reports.length === 0,
    "gpu: a depth-tested cube shows its front face (the back face, drawn last, stays behind); the depth texture follows the canvas size",
    { ...cube, cubePx },
  )
  await done(page)
  await mount(page, gpu.invalid)
  const invalid = await state(page)
  check(
    invalid.reports.length === 1 && invalid.reports[0]!.phase === "gpu" && /nope/.test(invalid.reports[0]!.message) && invalid.alt.startsWith("A GPU scene\n"),
    "gpu: a WebGPU validation error is a program error in phase gpu; the canvas shows its placeholder with it",
    { reports: invalid.reports, alt: invalid.alt.slice(0, 80) },
  )
  check(invalid.text.includes("over the scene"), "gpu: the rest of the widget keeps working (the layer over the canvas)", invalid.text)
  await done(page)
  await mount(page, gpu.written)
  const written = await state(page)
  const message = `gpu op 1: "writeTexture" argument 1 uses canvas "scene"'s texture, which can only be rendered into`
  check(
    written.reports.length === 1 && written.reports[0]!.message === message && written.alt === "A GPU scene\n" + message,
    "gpu: a write into a canvas's texture is a host check, the spec's message; the canvas shows it",
    { reports: written.reports, alt: written.alt },
  )
  await done(page)
  // NaN and infinities reach the page's checks as numbers (the worker puts back what JSON wrote as null): the fixtures'
  // exact messages, where a null would pass.
  for (const name of ["error-nan-rows-per-image", "error-infinite-depth-clear-value"]) {
    const f = (await Bun.file(new URL(`../../../widget/test/fixtures/gpu/${name}.json`, import.meta.url)).json()) as { source: string; errors: { message: string }[] }
    await mount(page, f.source)
    const got = await state(page)
    check(
      got.reports.length === 1 && got.reports[0]!.message === f.errors[0]!.message,
      `gpu: ${name} on the page: the fixture's message, the number kept a number`,
      { reports: got.reports, want: f.errors[0]!.message },
    )
    await done(page)
  }

  // opencode's example widget templates (test/fixtures/gpu/templates), running on.
  await copies()
  await mount(page, gpu.templates.cube, 2500)
  const tcube = await state(page)
  const common = await copies()
  check(
    common.copies === 0 && common.usages.length > 0 && common.usages.every((u) => u === 16),
    "gpu: the common case (every pass in the frame request's batch) renders straight into the current texture: 0 copies, contexts RENDER_ATTACHMENT only",
    common,
  )
  const tcubePx = (await pixels(page, tcube.rect!, CORNERS)).px
  const sorted = [...tcube.gpuMs].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? NaN
  check(
    tcube.reports.length === 0 && lit(tcubePx[0]) && tcubePx[0]![2]! > tcubePx[0]![0]! && near(tcubePx[1], [13, 13, 20], 10),
    `gpu template cube: lit and depth-tested, ${tcube.batches} frame batches in 2.5 s, replay median ${median.toFixed(2)} ms a batch`,
    { reports: tcube.reports, px: tcubePx, size: tcube.size },
  )
  await shot(page, "gpu-template-cube")
  await done(page)
  await mount(page, gpu.templates["textured-quad"])
  const quad = await state(page)
  const quadPx = (await pixels(page, quad.rect!, CORNERS)).px
  check(quad.reports.length === 0 && lit(quadPx[0]) && near(quadPx[1], [0, 0, 0]), "gpu template textured-quad: the texture written in script shows, sampled", { reports: quad.reports, px: quadPx })
  await shot(page, "gpu-template-textured-quad")
  await done(page)
  await mount(page, gpu.templates["post-process"])
  const post = await state(page)
  const postPx = (await pixels(page, post.rect!, CORNERS)).px
  check(
    post.reports.length === 0 && !near(postPx[0], postPx[1]!, 4) && lit(postPx[0]),
    "gpu template post-process: renders to a texture, then samples it in a full-screen pass",
    { reports: post.reports, px: postPx },
  )
  await shot(page, "gpu-template-post-process")
  await done(page)

  // The maze: a click focuses and asks for the pointer, the next locks it; WASD walks, the mouse turns; Esc lets go.
  await mount(page, gpu.templates.maze, 2000)
  const hud = async () => (await state(page)).text.join(" | ")
  const until = async (re: RegExp, ms = 3000) => {
    const end = Date.now() + ms
    let t = await hud()
    while (Date.now() < end && !re.test(t)) {
      await page.waitForTimeout(50)
      t = await hud()
    }
    return t
  }
  const maze = await state(page)
  const r = maze.rect!
  const before = await pixels(page, r, CORNERS)
  check(maze.reports.length === 0 && lit(before.px[0]) && /Click or drag to look/.test(await hud()), "gpu template maze: renders, with its HUD over the canvas", { reports: maze.reports, px: before.px, text: maze.text })
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
  await page.waitForTimeout(300)
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
  const captured = await until(/WASD to walk/)
  const locked = await page.evaluate(() => document.pointerLockElement !== null)
  check(/WASD to walk/.test(captured) && locked, "gpu template maze: a click captures the pointer (the HUD says so)", { captured, locked })
  const still = await pixels(page, r, CORNERS)
  await page.keyboard.down("KeyW")
  await page.waitForTimeout(600)
  await page.keyboard.up("KeyW")
  await page.waitForTimeout(200)
  const walked = await pixels(page, r, CORNERS)
  check(Buffer.compare(still.png, walked.png) !== 0, "gpu template maze: W walks (the view changes)")
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(r.x + r.width / 2 + (i + 1) * 15, r.y + r.height / 2)
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(200)
  const turned = await pixels(page, r, CORNERS)
  check(Buffer.compare(walked.png, turned.png) !== 0, "gpu template maze: relative mouse moves turn the camera (the view changes)")
  await shot(page, "gpu-template-maze")
  await page.keyboard.press("Escape")
  const released = await until(/Click or drag to look/)
  check(/Click or drag to look/.test(released) && (await state(page)).reports.length === 0, "gpu template maze: Esc lets the pointer go; no program errors", released)
  await done(page)
  /** Each GPU canvas in order: its rect, the text its placeholder shows ("" while it draws), and its backing size. */
  const canvases = (page: Page) =>
    page.evaluate(() => {
      const g = (window as unknown as { __gpu: { slot: HTMLElement; reports: { phase: string; message: string }[]; clientErrors: string[] } }).__gpu
      const root = g.slot.querySelector(".psychoscript-widget")!.shadowRoot!
      return {
        reports: g.reports.map((r) => r.message),
        clientErrors: g.clientErrors,
        text: [...root.querySelectorAll(".pw-text")].map((t) => t.textContent ?? ""),
        canvases: [...root.querySelectorAll('.pw-surface[data-kind="webgpu"]')].map((s) => {
          const r = s.querySelector("canvas")!.getBoundingClientRect()
          const c = s.querySelector("canvas")!
          return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, alt: s.querySelector(".pw-alt")?.textContent ?? "", size: [c.width, c.height] }
        }),
      }
    })
  const centre = async (page: Page, rect: { x: number; y: number; width: number; height: number }) => (await pixels(page, rect, [[0.5, 0.5]])).px[0]

  // Several canvases in one batch: the error stops only the canvases the batch renders into; a stopped one's passes
  // are skipped while the others in the batch draw.
  await mount(page, gpu.isolated, 1500, { until: 7 })
  let two = await canvases(page)
  let a = await centre(page, two.canvases[0]!.rect)
  check(
    two.reports.length === 1 && two.reports[0]!.includes("was destroyed") && two.canvases[0]!.alt === "" && near(a, [255, 255, 0]) && two.canvases[1]!.alt.startsWith("B\n" + two.reports[0]),
    "gpu: a batch that makes a view of a but renders only into b stops b alone; a, in the same batches after, draws on",
    { ...two, a },
  )
  await done(page)
  await mount(page, gpu.isolated, 1500, { until: 12 })
  two = await canvases(page)
  check(
    two.reports.length === 2 && two.canvases[0]!.alt.startsWith("A\n" + two.reports[1]) && two.canvases[1]!.alt.startsWith("B\n" + two.reports[0]) && two.reports.every((r) => /^gpu op \d+: handle \d+ was destroyed$/.test(r)),
    "gpu: an error in a batch into a and b (b stopped) stops a, reported once; b keeps its first error",
    two,
  )
  await done(page)
  await mount(page, gpu.resolved)
  two = await canvases(page)
  const b = await centre(page, two.canvases[1]!.rect)
  check(
    two.reports.length === 1 && two.canvases[0]!.alt.startsWith("A\n") && two.canvases[1]!.alt === "" && near(b, [0, 0, 255]),
    "gpu: a canvas drawn through a pass's resolve target is rendered into: its batch's error stops it alone, not every canvas",
    { ...two, b },
  )
  await done(page)
  await mount(page, gpu.kept, 2000)
  two = await canvases(page)
  a = await centre(page, two.canvases[0]!.rect)
  check(two.reports.length === 0 && near(a, [255, 0, 0]), "gpu: frames with no pass into a canvas keep its last image", { ...two, a })
  await done(page)
  await copies()
  await mount(page, gpu.midFrame, 2500)
  two = await canvases(page)
  const mid = await copies()
  const half = async (rect: { x: number; y: number; width: number; height: number }) => (await pixels(page, rect, [[0.25, 0.5], [0.75, 0.5]])).px
  const [aLeft, aRight] = await half(two.canvases[0]!.rect)
  const [bLeft, bRight] = await half(two.canvases[1]!.rect)
  check(
    two.reports.length === 0 && near(aLeft, [255, 0, 0]) && near(aRight, [0, 255, 0]),
    "gpu: a frame that draws, sleeps longer than a display frame and draws again shows both (a kept texture for the frame)",
    { ...two, aLeft, aRight },
  )
  check(
    near(bLeft, [0, 0, 0]) && near(bRight, [0, 255, 0]),
    "gpu: a canvas drawn mid-frame is cleared at the frame boundary: the frame's first pass (loadOp load) sees transparent",
    { bLeft, bRight },
  )
  check(
    mid.copies >= 4 && mid.copies <= 20 && mid.usages.some((u) => u === (16 | 2)),
    `gpu: only a canvas drawn mid-frame gets COPY_DST and copies (${mid.copies} copies over 4 frames and their sleeps)`,
    mid,
  )
  await done(page)

  check(errors.length === 0, "gpu: no page errors", errors)
  await page.close()

  // A device loss after an error: the new device restarts the canvas the loss stopped (b), never the one an error
  // stopped (a).
  {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.addInitScript(() => {
      const w = window as unknown as { __devices: GPUDevice[] }
      w.__devices = []
      const request = GPUAdapter.prototype.requestDevice
      GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, d?: GPUDeviceDescriptor) {
        const device = await request.call(this, d)
        w.__devices.push(device)
        return device
      }
    })
    await page.addInitScript(steady)
    await page.goto(base + "?only=confirm")
    await mount(page, gpu.restarted, 1500)
    const before = await canvases(page)
    await page.evaluate(() => (window as unknown as { __devices: GPUDevice[] }).__devices.at(-1)!.destroy())
    await page.waitForTimeout(1500)
    const after = await canvases(page)
    const b = await centre(page, after.canvases[1]!.rect)
    const devices = await page.evaluate(() => (window as unknown as { __devices: GPUDevice[] }).__devices.length)
    check(
      before.text.includes("waiting") && after.text.includes("restarted") && devices === 2 && after.reports.length === 1 &&
        after.canvases[0]!.alt.startsWith("A\n" + after.reports[0]) && after.canvases[1]!.alt === "" && near(b, [0, 0, 255]),
      "gpu: after a loss, a new device restarts the canvas the loss stopped (b draws), never the one an error stopped (a)",
      { before, after, b, devices },
    )
    await done(page)
    check(errors.length === 0, "gpu (restart): no page errors", errors)
    await page.close()
  }

  // A GPU hang: the first batch drawing a finishes 1.5 s after its submit. At 250 ms a stops (a client error, its
  // placeholder with the message); b draws on; a later device loss restarts b, never a.
  {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.addInitScript(() => {
      const w = window as unknown as { __devices: GPUDevice[] }
      w.__devices = []
      const request = GPUAdapter.prototype.requestDevice
      GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, d?: GPUDeviceDescriptor) {
        const device = await request.call(this, d)
        w.__devices.push(device)
        return device
      }
      // The first canvas drawn is a; the work submitted with its first frame takes 1.5 s.
      let first: HTMLCanvasElement | OffscreenCanvas | undefined
      let hang = false
      const current = GPUCanvasContext.prototype.getCurrentTexture
      GPUCanvasContext.prototype.getCurrentTexture = function (this: GPUCanvasContext) {
        first ??= this.canvas
        if (this.canvas === first && !hang) hang = true
        return current.call(this)
      }
      // That one 1.5 s, whatever SwiftShader takes; the rest when the GPU is done, or after 100 ms at most.
      let hung = false
      const done = GPUQueue.prototype.onSubmittedWorkDone
      GPUQueue.prototype.onSubmittedWorkDone = function (this: GPUQueue) {
        const after = (ms: number) => new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))
        if (!hang || hung) return Promise.race([done.call(this), after(100)])
        hung = true
        return after(1500)
      }
    })
    await page.goto(base + "?only=confirm")
    await mount(page, gpu.hung, 1600)
    const before = await canvases(page)
    const bDrawn = await centre(page, before.canvases[1]!.rect)
    await page.evaluate(() => (window as unknown as { __devices: GPUDevice[] }).__devices.at(-1)!.destroy())
    await page.waitForTimeout(1500)
    const after = await canvases(page)
    const b = await centre(page, after.canvases[1]!.rect)
    const message = "the GPU work hung; the canvas is stopped"
    check(
      before.clientErrors.length === 1 && before.clientErrors[0] === message && before.reports.length === 0 &&
        before.canvases[0]!.alt === "A\n" + message && before.canvases[1]!.alt === "" && near(bDrawn, [0, 255, 0]),
      "gpu: a batch unfinished 250 ms after its submit stops the canvas it draws into (a client error, its placeholder with the message); the other draws on",
      { ...before, bDrawn },
    )
    check(
      after.text.includes("restarted") && after.clientErrors.length === 1 && after.reports.length === 0 &&
        after.canvases[0]!.alt === "A\n" + message && after.canvases[1]!.alt === "" && near(b, [0, 0, 255]),
      "gpu: a later device loss restarts the other canvas, never the one a GPU hang stopped",
      { ...after, b },
    )
    await done(page)
    check(errors.length === 0, "gpu (hang): no page errors", errors)
    await page.close()
  }

  // Strikes (widgets-gpu.md), losses made by the check: the device is destroyed right after a submit whose work it keeps
  // unfinished. Two losses in a row with no work finished between (the new device's first submit kept unfinished too)
  // are one strike, which changes nothing; a later loss after work finished is the second, which stops the run.
  {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.addInitScript(() => {
      const w = window as unknown as { __devices: GPUDevice[]; __loseNext: number }
      w.__devices = []
      w.__loseNext = 0
      const request = GPUAdapter.prototype.requestDevice
      GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, d?: GPUDeviceDescriptor) {
        const device = await request.call(this, d)
        w.__devices.push(device)
        return device
      }
      // The next `__loseNext` submits: each kept unfinished, its device then lost.
      const done = GPUQueue.prototype.onSubmittedWorkDone
      GPUQueue.prototype.onSubmittedWorkDone = function (this: GPUQueue) {
        if (!w.__loseNext) return Promise.race([done.call(this), new Promise<undefined>((r) => setTimeout(() => r(undefined), 100))])
        w.__loseNext--
        const device = w.__devices.find((d) => d.queue === this)!
        setTimeout(() => device.destroy())
        return new Promise<undefined>(() => {})
      }
    })
    await page.goto(base + "?only=confirm")
    await mount(page, gpu.struck, 1000)
    const lose = async (losses: number) => {
      await page.evaluate((n) => ((window as unknown as { __loseNext: number }).__loseNext = n), losses)
      await page.waitForTimeout(1500)
      return canvases(page)
    }
    const first = await lose(2)
    const a1 = await centre(page, first.canvases[0]!.rect)
    const message = "the GPU work hung; the canvas is stopped"
    check(
      first.text.includes("devices 3") && first.clientErrors.length === 0 && first.reports.length === 0 &&
        first.canvases.every((c) => c.alt === "") && near(a1, [0, 0, 255]),
      "gpu: two losses in a row with no work finished between are one strike, which changes nothing: the canvases restart",
      { ...first, a1 },
    )
    const second = await lose(1)
    check(
      second.text.includes("devices 4") && second.clientErrors.length === 1 && second.clientErrors[0] === message &&
        second.reports.length === 0 && second.canvases[0]!.alt === "A\n" + message && second.canvases[1]!.alt === "B\n" + message,
      "gpu: a loss after work finished is the second strike within 30 s: every GPU canvas of the run stops (a client error, once); its new device restarts none",
      second,
    )
    await done(page)
    check(errors.length === 0, "gpu (strikes): no page errors", errors)
    await page.close()
  }

  // The wgsl shaders share one device, and strikes are the run's: a loss with S1's frame unfinished (64 px wide) and
  // one with S2's (96 px) are the run's two strikes, which stop both (counted per shader, neither would stop).
  {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.addInitScript(() => {
      const w = window as unknown as { __devices: GPUDevice[]; __loseNext: number }
      w.__devices = []
      w.__loseNext = 0
      const request = GPUAdapter.prototype.requestDevice
      GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, d?: GPUDeviceDescriptor) {
        const device = await request.call(this, d)
        w.__devices.push(device)
        return device
      }
      // A shader's frame: its canvas's texture, then its submit, then its onSubmittedWorkDone.
      let drawing: HTMLCanvasElement | OffscreenCanvas | undefined
      const current = GPUCanvasContext.prototype.getCurrentTexture
      GPUCanvasContext.prototype.getCurrentTexture = function (this: GPUCanvasContext) {
        drawing = this.canvas
        return current.call(this)
      }
      // Done at once (no 50 ms rule here), but the next frame of the shader `__loseNext` px wide: unfinished, then the
      // device lost.
      GPUQueue.prototype.onSubmittedWorkDone = function (this: GPUQueue) {
        if (!w.__loseNext || drawing?.width !== Math.round(w.__loseNext * devicePixelRatio)) return Promise.resolve(undefined)
        w.__loseNext = 0
        const device = w.__devices.find((d) => d.queue === this)!
        setTimeout(() => device.destroy())
        return new Promise<undefined>(() => {})
      }
    })
    await page.goto(base + "?only=confirm")
    await mount(page, gpu.shaders, 3000)
    const shaders = () =>
      page.evaluate(() => {
        const g = (window as unknown as { __gpu: { slot: HTMLElement; clientErrors: string[] } }).__gpu
        const root = g.slot.querySelector(".psychoscript-widget")!.shadowRoot!
        const surfaces = [...root.querySelectorAll('.pw-surface[data-kind="gpu"]')]
        return { clientErrors: [...g.clientErrors], shaders: surfaces.map((s) => ({ builds: s.getAttribute("data-builds"), alt: s.querySelector(".pw-alt")?.textContent ?? "" })) }
      })
    const lose = async (width: number) => {
      await page.evaluate((width) => ((window as unknown as { __loseNext: number }).__loseNext = width), width)
      await page.waitForTimeout(2500)
      return shaders()
    }
    const first = await lose(64)
    const message = "the GPU work hung; the canvas is stopped"
    check(
      first.clientErrors.length === 0 && first.shaders.every((s) => s.builds === "2" && s.alt === ""),
      "shader: after a loss both shaders are built again on a new device; the run's first strike changes nothing",
      first,
    )
    const second = await lose(96)
    check(
      second.clientErrors.length === 1 && second.clientErrors[0] === message &&
        second.shaders[0]!.alt === "S1\n" + message && second.shaders[1]!.alt === "S2\n" + message,
      "shader: strikes are the run's: S1's loss then S2's stop both shaders (one client error), neither built again",
      second,
    )
    await done(page)
    check(errors.length === 0, "shader (strikes): no page errors", errors)
    await page.close()
  }

  // Canvas size: 1500 x 200 at scale 3 is 4500 x 600 physical, clamped to 4096 x 546; a texture that size fits.
  {
    const { page, errors } = await open("?only=confirm", { width: 1600, height: 500 }, 3)
    await mount(page, gpu.clamped, 2500, null, 1500)
    const big = await canvases(page)
    const px = await centre(page, big.canvases[0]!.rect)
    check(
      big.reports.length === 0 && big.canvases[0]!.size.join("x") === "4096x546" && big.text.includes("4096x546") && near(px, [0, 255, 0]),
      "gpu: a canvas over 4096 physical px is clamped with its aspect kept (4500 x 600 -> 4096 x 546), the program told so; a texture its size fits",
      { ...big, px },
    )
    await done(page)
    check(errors.length === 0, "gpu (clamp): no page errors", errors)
    await page.close()
  }
}
{
  // No WebGPU: the canvas shows its placeholder, the program runs on, nothing is reported.
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.addInitScript(() => delete (Navigator.prototype as { gpu?: unknown }).gpu)
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(base + "?only=confirm")
  await page.waitForTimeout(500)
  const got = await page.evaluate(async (source) => {
    const d = (window as unknown as { __demo: { host: { mount(el: HTMLElement, o: object): { destroy(): void } }; prelude: string; program(source: string, mode: string): string } }).__demo
    const slot = document.createElement("div")
    document.body.prepend(slot)
    const reports: unknown[] = []
    const clientErrors: string[] = []
    d.host.mount(slot, { program: d.program(source, "live"), data: null, mode: "live", onReport: (e: unknown) => reports.push(e), onClientError: (m: string) => clientErrors.push(m) })
    await new Promise((r) => setTimeout(r, 1500))
    const root = slot.querySelector(".psychoscript-widget")!.shadowRoot!
    return { reports, clientErrors, alt: root.querySelector(".pw-surface .pw-alt")?.textContent ?? "", text: [...root.querySelectorAll(".pw-text")].map((t) => t.textContent) }
  }, (await import("./gpu-programs.ts")).cube)
  check(
    got.alt === "A GPU scene" && got.text.includes("over the scene") && got.reports.length === 0 && got.clientErrors.length > 0,
    "gpu: without WebGPU the canvas shows its placeholder (alt), the layer over it stays, nothing is reported",
    got,
  )
  // The `wgsl` shorthand too: no WebGL fallback, its placeholder; the widget's controls keep working.
  await page.goto(base + "?only=backdrop")
  const w = widget(page, "backdrop")
  await rendered(w)
  await page.waitForTimeout(800)
  const shorthand = await w.evaluate((el) => {
    const root = el.shadowRoot!
    return { alt: root.querySelector(".pw-surface .pw-alt")?.textContent ?? "", backend: (root.querySelector(".pw-surface") as HTMLElement).dataset.backend ?? "", slider: root.querySelectorAll("input.pw-slider").length }
  })
  const reported = await waitLog(page, (l) => l.startsWith("backdrop report"), 300)
  check(
    shorthand.alt.length > 0 && shorthand.backend === "" && shorthand.slider === 1 && reported === undefined,
    "gpu: a wgsl canvas without WebGPU shows its placeholder (no WebGL), not reported; the controls stay",
    shorthand,
  )
  check(errors.length === 0, "gpu (no WebGPU): no page errors", errors)
  await page.close()
}
{
  // Device loss: the program gets `{ type: "gpu", lost }`; the canvas shows its placeholder until it starts again.
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.addInitScript(steady)
  await page.addInitScript(() => {
    const w = window as unknown as { __devices: GPUDevice[]; __delivered: unknown[] }
    w.__devices = []
    w.__delivered = []
    const request = GPUAdapter.prototype.requestDevice
    GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, d?: GPUDeviceDescriptor) {
      const device = await request.call(this, d)
      w.__devices.push(device)
      return device
    }
    const send = Worker.prototype.postMessage as (this: Worker, m: unknown, t?: Transferable[]) => void
    Worker.prototype.postMessage = function (this: Worker, m: unknown, t?: unknown) {
      const message = (m as { t?: string; message?: { type?: string } }).message
      if ((m as { t?: string }).t === "deliver" && message?.type === "gpu") w.__delivered.push(message)
      return send.call(this, m, t as Transferable[])
    } as typeof Worker.prototype.postMessage
  })
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(base + "?only=confirm")
  await page.waitForTimeout(500)
  const got = await page.evaluate(async (source) => {
    const w = window as unknown as { __demo: { host: { mount(el: HTMLElement, o: object): { destroy(): void } }; prelude: string; program(source: string, mode: string): string }; __devices: GPUDevice[]; __delivered: unknown[] }
    const slot = document.createElement("div")
    document.body.prepend(slot)
    const reports: unknown[] = []
    w.__demo.host.mount(slot, { program: w.__demo.program(source, "live"), data: null, mode: "live", onReport: (e: unknown) => reports.push(e) })
    await new Promise((r) => setTimeout(r, 1500))
    const devices = w.__devices.length
    w.__devices.at(-1)?.destroy()
    await new Promise((r) => setTimeout(r, 500))
    const root = slot.querySelector(".psychoscript-widget")!.shadowRoot!
    return { devices, delivered: w.__delivered, reports, alt: root.querySelector(".pw-surface .pw-alt")?.textContent ?? "" }
  }, (await import("./gpu-programs.ts")).cube)
  check(
    (got.delivered as { lost?: string }[]).some((m) => m.lost === "destroyed") && got.alt === "A GPU scene" && got.reports.length === 0,
    "gpu: a lost device is sent to the program ({ type: 'gpu', lost }) and the canvas shows its placeholder",
    got,
  )
  check(errors.length === 0, "gpu (device loss): no page errors", errors)
  await page.close()
}

// ---------- local network in dev mode ----------
for (const [query, on] of [["?only=local-demo", true], ["?only=local-demo&local=0", false]] as const) {
  const { page, errors } = await open(query)
  const w = widget(page, "local-demo")
  await rendered(w)
  const end = Date.now() + 8000
  let text = ""
  while (Date.now() < end && !/status|CapabilityDenied|Network/.test(text)) {
    text = (await w.locator(".pw-text").allTextContents()).join(" | ")
    await page.waitForTimeout(100)
  }
  if (on) {
    check(/status 200/.test(text), "fetch: allowLocalNetwork lets a declared localhost:port through over http:", text)
    check(/local network allowed/.test((await w.locator(".pw-chip").textContent()) ?? ""), "fetch: the chip says the local network is allowed")
    await shot(w, "local-network")
  } else check(/CapabilityDenied: only https/.test(text), "fetch: without allowLocalNetwork the same request is denied", text)
  check(errors.length === 0, `local network (${on ? "on" : "off"}): no page errors`, errors)
  await page.close()
}

await browser.close()
console.log(failures === 0 ? "all checks passed" : `${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
