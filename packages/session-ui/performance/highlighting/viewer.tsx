import { render } from "solid-js/web"
import { createPatch } from "diff"
import type { WorkerRequest, WorkerResponse, WorkerRenderingOptions } from "@pierre/diffs/worker"
import type { RenderDiffOptions } from "@pierre/diffs"
import { File } from "../../src/components/file"
import { normalize, text } from "../../src/components/session-diff"
import { getWorkerPool } from "../../src/pierre/worker"
import "../../../ui/src/styles/theme.css"

// This fixture uses the production component, normalizer, pool, and worker bundle.
// Observe messages without replacing the worker or its implementation.
const messages: { type: string; at: number; end?: number }[] = []
const listening = new WeakSet<Worker>()
const pending = new Map<string, (typeof messages)[number]>()
const postMessage = Worker.prototype.postMessage
Worker.prototype.postMessage = function (message: WorkerRequest, options?: Transferable[] | StructuredSerializeOptions) {
  if (!listening.has(this)) {
    listening.add(this)
    this.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const item = pending.get(event.data.id)
      if (item) item.end = performance.now()
      pending.delete(event.data.id)
    }, { capture: true })
  }
  const item = { type: message.type, at: performance.now() }
  messages.push(item)
  pending.set(message.id, item)
  postMessage.call(this, message, Array.isArray(options) ? { transfer: options } : options)
}

function source(count: number, revision: number) {
  return Array.from({ length: count }, (_, index) => {
    const status = index % 10 === 0 ? 200 + revision : 200
    return `export async function route${index}(request: Request, context: RouteContext) {
  const account = await context.accounts.find(request.headers.get("account-id"))
  if (!account) return new Response("Account not found", { status: 404 })
  const payload = await request.json()
  const record = await context.records.save({
    accountId: account.id,
    category: "route-${index}",
    title: payload.title.trim(),
    enabled: payload.enabled ?? true,
  })
  return Response.json({ id: record.id, status: ${status} })
}
`
  }).join("\n")
}

const large = new URLSearchParams(location.search).has("large")
const before = source(large ? 1200 : 120, 0)
const inputs = [1, 2].map((revision) => {
  const after = source(large ? 1200 : 120, revision)
  return { file: "routes.ts", patch: createPatch("routes.ts", before, after, "", "", { context: Infinity }), after }
})
const host = document.getElementById("root")!
let dispose: VoidFunction | undefined
let active: ReturnType<typeof normalize> | undefined

document.head.insertAdjacentHTML("beforeend", `<style>
  :root { color-scheme: light; --font-family-mono: monospace; --font-size-small: 13px;
    --color-background-stronger: white; --v2-background-bg-accent: #007acc; --v2-text-text-accent: #005a9e; }
  body { margin: 16px; } #root { height: 760px; overflow: auto; overflow-anchor: none; }
  [data-slot="file-header"] { height: 40px; line-height: 40px; font: 13px system-ui; padding: 0 12px; }
</style>`)

type Measurement = {
  readyMs: number
  firstReadyMs: number
  workerRequests: number
  workerRoundTripMs: number
  cacheSize: number
  syntaxSpans: number
  options: RenderDiffOptions
}

async function mount(revision: number) {
  if (dispose) throw new Error("Unmount the previous viewer first")
  const input = inputs[revision - 1]
  const offset = messages.length
  const start = performance.now()
  active = normalize({ ...input, additions: large ? 120 : 12, deletions: large ? 120 : 12 })
  const pool = getWorkerPool(large ? "none" : "word-alt")!
  let firstReady = 0
  let rendered = 0
  let finish!: (value: Measurement) => void
  const result = new Promise<Measurement>((resolve) => (finish = resolve))
  const check = () => {
    const stats = pool.getStats()
    if (!firstReady || !rendered || stats.managerState !== "initialized" || stats.activeTasks || stats.queuedTasks || stats.busyWorkers) return
    const work = messages.slice(offset).filter((item) => item.type === "diff")
    if (work.some((item) => !item.end || rendered < item.end)) return
    const root = host.querySelector("diffs-container")?.shadowRoot
    const edit = root?.querySelector('[data-line="11"][data-line-type="change-addition"]')
    if (!root || !edit?.textContent?.includes(`status: ${200 + revision}`)) return
    const range = document.createRange()
    range.selectNodeContents(edit)
    const bounds = range.getBoundingClientRect()
    if (bounds.top < host.getBoundingClientRect().top || bounds.bottom > host.getBoundingClientRect().bottom) return
    finish({
      readyMs: performance.now() - start,
      firstReadyMs: firstReady - start,
      workerRequests: work.length,
      workerRoundTripMs: work.reduce((sum, item) => sum + item.end! - item.at, 0),
      cacheSize: stats.diffCacheSize,
      syntaxSpans: root.querySelectorAll('[data-line] [style*="--syntax-"]').length,
      options: pool.getDiffRenderOptions(),
    })
  }
  const unsubscribe = pool.subscribeToStatChanges(check)
  // Production surfaces place a header or earlier content above the diff inside a `[role="log"]` scroll content
  // element. An empty diff element at scroll offset 0 makes Pierre's virtualizer anchor its bottom edge and scroll
  // the host by the full content height once the first rows render.
  dispose = render(() => <div role="log">
    <div data-slot="file-header">{input.file}</div>
    <File mode="diff" fileDiff={active!.fileDiff}
      onRendered={() => { firstReady ||= performance.now(); check() }}
      onPostRender={(_, __, phase) => {
        if (phase === "unmount") return
        rendered = performance.now()
        queueMicrotask(check)
      }} />
  </div>, host)
  const value = await result
  unsubscribe()
  return value
}

export const highlighting = {
  mount,
  configure(options: Partial<WorkerRenderingOptions>) { return getWorkerPool(large ? "none" : "word-alt")!.setRenderOptions(options) },
  unmount() { dispose?.(); dispose = undefined; host.scrollTop = 0 },
  contents() { return active && { before: text(active, "deletions"), after: text(active, "additions") } },
  input: { before, after: inputs.map((input) => input.after) },
  dimensions: {
    functions: large ? 1200 : 120,
    beforeBytes: new TextEncoder().encode(before).length,
    afterBytes: new TextEncoder().encode(inputs[0].after).length,
    patchBytes: new TextEncoder().encode(inputs[0].patch).length,
    lines: before.split("\n").length - 1,
  },
}

declare global { interface Window { highlighting: typeof highlighting } }
window.highlighting = highlighting
