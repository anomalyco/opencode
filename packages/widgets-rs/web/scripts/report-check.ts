#!/usr/bin/env bun
// What a live widget's failure reports (`onReport`) on this host, in a real Chromium: a fetch rejection the program lets
// escape (raw or through `widget.fetch`) is a fetch error; it, a GPU op error (at the frame request that posted the
// batch), a check of the GPU recording API and an invalid draw say the widget template's line and column. Headless;
// the programs on packages/widget's preludes. Needs the demo server (bun scripts/serve.ts) and dist/ built.
//
// Env: CHROMIUM (executable), DEMO (base URL).
import path from "node:path"
import { chromium } from "playwright-core"

const exe = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`
const base = process.env.DEMO ?? "http://localhost:4173/demo/"
const widget = path.resolve(import.meta.dir, "../../../widget/src")
// A live program: the prelude, the live prelude, then the source (widgets.md, Prelude and step ABI).
const prelude = (await Bun.file(path.join(widget, "prelude.js")).text()) + "\n" + (await Bun.file(path.join(widget, "prelude-live.js")).text())
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--enable-unsafe-webgpu"] })
const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
await page.goto(base + "?only=none")
await page.waitForFunction(() => "__demo" in window)

interface Report {
  phase: string
  message: string
  line?: number
  column?: number
}

/** Mounts `source` as a live widget; its first report, within 6 s. */
const report = (source: string, hosts?: string[]) =>
  page.evaluate(
    ({ program, source, hosts }) =>
      new Promise<Report | undefined>((resolve) => {
        const d = (window as unknown as { __demo: { host: { mount(el: HTMLElement, o: object): { destroy(): void } } } }).__demo
        const slot = document.createElement("div")
        document.body.prepend(slot)
        let widget: { destroy(): void } | undefined
        const done = (r: Report | undefined) => {
          clearTimeout(timer)
          widget?.destroy()
          slot.remove()
          resolve(r)
        }
        const timer = setTimeout(() => done(undefined), 6000)
        widget = d.host.mount(slot, {
          program,
          source,
          mode: "live",
          data: null,
          capabilities: hosts ? { https: { hosts } } : undefined,
          onReport: (r: Report) => done(r),
        })
      }),
    { program: prelude + "\n" + source, source, hosts },
  )

let failures = 0
const check = (what: string, got: Report | undefined, want: Omit<Report, "column">) => {
  const ok = got !== undefined && got.phase === want.phase && got.message === want.message && got.line === want.line && (got.column ?? 0) > 0
  console.log(`${ok ? "ok  " : "FAIL"} ${what} (${JSON.stringify(got)})`)
  if (!ok) failures++
}

check(
  "an uncaught __host.fetch rejection keeps its kind: a fetch error at its line",
  await report('async function main() {\n  await __host.fetch({ url: "https://example.org", method: "GET", headers: {} })\n}\n'),
  { phase: "fetch", message: "Error: this widget has no https capability", line: 2 },
)
check(
  "an uncaught widget.fetch denial is a fetch error at its template line 3",
  await report('async function main() {\n  widget.render(ui.text("x"))\n  await widget.fetch("https://example.org/a")\n}\n', ["api.example.com"]),
  { phase: "fetch", message: "Error: example.org isn't among the hosts this widget may reach", line: 3 },
)
check(
  "a GPU op error is at the frame request that posted its batch (line 6)",
  await report(`async function main() {
  widget.render(ui.canvas({ key: "scene", gpu: true, height: 100 }))
  const device = await widget.gpu.requestDevice()
  widget.gpu.getContext("scene").configure({ device, format: widget.gpu.getPreferredCanvasFormat() })
  device.createBuffer({ size: 64 * 1024 * 1024 + 4, usage: GPUBufferUsage.VERTEX })
  for (let i = 0; i < 20; i++) await widget.frame()
}
`),
  { phase: "gpu", message: 'gpu op 1: "buffer" argument 2 is over the limit of 67108864', line: 6 },
)
check(
  "a GPU recording API error is at its line 4",
  await report(`async function main() {
  widget.render(ui.canvas({ key: "scene", gpu: true, height: 100 }))
  const device = await widget.gpu.requestDevice()
  device.createBuffer()
  await widget.frame()
}
`),
  { phase: "main", message: "TypeError: createBuffer's descriptor must be an object", line: 4 },
)
check(
  "an invalid draw is in phase draw at its line 3",
  await report('async function main() {\n  widget.render(ui.canvas({ key: "c", height: 10 }))\n  widget.draw("c", [["bogus"]])\n  await widget.frame()\n}\n'),
  { phase: "draw", message: 'draw command 0: unknown draw command "bogus"', line: 3 },
)

await browser.close()
console.log(failures === 0 ? "reports: all checks pass" : `reports: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
