/// <reference types="vite/client" />
import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { PlatformProvider, type Platform } from "@/runtime/platform/platform"
import { createBrowserDraftStore } from "@/runtime/persistence/drafts"
import { createComposerHistory } from "@/composer/history/store"
import { ComposerEditor } from "@/composer/editor/editor"
import { createComposerEditor } from "@/composer/editor/interaction"
import type { ComposerPersistedState } from "@/composer/types"
import "@/index.css"

const shape = new URLSearchParams(location.search).get("shape") ?? "text"
const normal = Array.from({ length: 100 }, (_, index) => {
  const content =
    `Review the retry policy in src/network/request-${index}.ts. Preserve cancellation and the existing error messages.\n\n` +
    `The request should stop after three attempts. Add coverage for a 429 response, a connection reset, and a successful retry. Verify that only idempotent requests are retried.\n\n` +
    `Report ${index}:\n\`\`\`ts\nexport async function request(input: Request) {\n  const response = await fetch(input)\n  if (!response.ok) throw new Error(response.statusText)\n  return response.json()\n}\n\`\`\``
  return {
    prompt: [
      { type: "text", content, start: 0, end: content.length },
      ...(shape !== "text" && index % 2 === 0
        ? [
            {
              type: "image",
              id: `attachment-${index}`,
              filename: `request-${index}.png`,
              mime: "image/png",
              blob: { id: `screenshot-${shape === "repeated" ? index % 10 : index}` },
            },
          ]
        : []),
    ],
    comments: [],
  }
})
const shell = Array.from({ length: 100 }, (_, index) => {
  const content = `bun test src/network/request-${index}.test.ts --timeout 30000`
  return { prompt: [{ type: "text", content, start: 0, end: content.length }], comments: [] }
})

// Seed only this Playwright context, before opening the production draft store.
const request = indexedDB.open("opencode-drafts", 1)
request.onupgradeneeded = () => {
  request.result.createObjectStore("documents")
  request.result.createObjectStore("blobs")
}
const db = await new Promise<IDBDatabase>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
const ids = [...new Set(normal.flatMap((entry) => entry.prompt.flatMap((part) => (part.blob ? [part.blob.id] : []))))]
const screenshots: { id: string; blob: Blob }[] = []
for (const id of ids) {
  const canvas = document.createElement("canvas")
  canvas.width = 1440
  canvas.height = 900
  const context = canvas.getContext("2d")!
  context.fillStyle = "#15191f"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.font = "16px monospace"
  context.fillStyle = "#b8c8d8"
  context.fillText(`request.ts - ${id}`, 30, 35)
  for (let line = 0; line < 38; line++) {
    context.fillStyle = line % 3 ? "#a8c7ba" : "#d4a882"
    context.fillText(
      `${String(line + 1).padStart(3)}  const response${line} = await fetch('/api/request/${id}/${line}', { signal, headers });`,
      30,
      70 + line * 20,
    )
  }
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"))
  screenshots.push({ id, blob })
}
const transaction = db.transaction(["documents", "blobs"], "readwrite")
transaction.objectStore("documents").put(JSON.stringify({ entries: normal }), "opencode.global.dat:prompt-history")
transaction.objectStore("documents").put(JSON.stringify({ entries: shell }), "opencode.global.dat:prompt-history-shell")
screenshots.forEach(({ id, blob }) => transaction.objectStore("blobs").put(blob, id))
await new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error)
})
db.close()

const metrics = { reads: 0, blobBytes: 0, documents: 0 }
const originalGet = IDBObjectStore.prototype.get
IDBObjectStore.prototype.get = function (key) {
  const request = originalGet.call(this, key)
  if (this.name === "documents") metrics.documents++
  if (this.name === "blobs") {
    metrics.reads++
    request.addEventListener("success", () => {
      metrics.blobBytes += request.result?.size ?? 0
    })
  }
  return request
}
const platform: Platform = {
  platform: "web",
  draftStore: createBrowserDraftStore(),
  openExternal() {},
  restart: async () => {},
  notify: async () => {},
}
const [state, setState] = createStore({ mount: 0, ready: false, result: "" })
const workload = {
  shape,
  normalEntries: normal.length,
  shellEntries: shell.length,
  imageReferences: shape === "text" ? 0 : 50,
  uniqueImages: ids.length,
  storedImageBytes: screenshots.reduce((sum, item) => sum + item.blob.size, 0),
  documentBytes: [normal, shell].reduce(
    (sum, entries) => sum + new TextEncoder().encode(JSON.stringify({ entries })).length,
    0,
  ),
  screenshotDimensions: [1440, 900],
}
let started = 0
function mount() {
  metrics.reads = 0
  metrics.blobBytes = 0
  metrics.documents = 0
  setState({ ready: false, result: "" })
  started = performance.now()
  setState("mount", state.mount + 1)
}
function Destination() {
  // Same history creation and editor mapping as createComposerModel. Destination draft is empty.
  const history = createComposerHistory()
  const store = createStore<ComposerPersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
    context: { items: [] },
  })
  const controller = createComposerEditor({
    store,
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    history: {
      entries: (mode) => history.entries(mode).map((entry) => ({ prompt: entry.prompt, metadata: entry.comments })),
      add: (prompt, mode) => history.add(prompt, mode, []),
    },
    view: {
      placeholder: () => "Empty destination composer",
      submit: { stopping: () => false, onSubmit() {}, onStop() {} },
    },
  })
  createEffect(() => {
    if (history.entries("normal").length !== 100 || history.entries("shell").length !== 100) return
    setState({
      ready: true,
      result: JSON.stringify({ historyReadyMs: performance.now() - started, ...metrics, ...workload }),
    })
  })
  return <ComposerEditor controller={controller} />
}
render(
  () => (
    <PlatformProvider value={platform}>
      <main style={{ padding: "40px", width: "900px" }}>
        <h1>Composer global history: {shape}</h1>
        <button onClick={mount}>Mount empty composer</button>
        <output data-testid="history-ready">{state.ready ? "ready" : "idle"}</output>
        <pre data-testid="history-result">{state.result}</pre>
        <Show when={state.mount} keyed>
          {(_mount) => <Destination />}
        </Show>
      </main>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
