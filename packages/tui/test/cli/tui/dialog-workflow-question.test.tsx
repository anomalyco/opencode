/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import type { WorkflowRun } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { directory, json } from "../../fixture/tui-sdk"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function pausedRun(): WorkflowRun {
  return {
    id: "job_q",
    workflow: "demo",
    status: "running",
    started_at: 1,
    logs: [],
    agents: [],
    pending_question: { question: "Pick one?", options: ["alpha", "beta"], asked_at: 1 },
  }
}

async function mountQuestion(input: { root: string; onClose: (resumeRunID?: string) => void }) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  // Capture the answer the dialog submits to the generated client's answer route,
  // and echo back a 200 run so the dialog resolves in place.
  const answered: { id: string; body: { answer: string; permissionSessionID?: string } }[] = []
  const fetchImpl = (async (req: RequestInfo | URL, init?: RequestInit) => {
    const request = req instanceof Request ? req : new Request(req, init)
    const url = new URL(request.url)
    const match = url.pathname.match(/^\/workflow\/run\/([^/]+)\/answer$/)
    if (match && request.method === "POST") {
      answered.push({ id: match[1], body: JSON.parse(await request.text()) })
      // Echo a 200 run with the question cleared (live in-place resolution).
      return json({ ...pausedRun(), pending_question: undefined })
    }
    // The SDK provider opens an SSE stream on mount; keep it open and empty.
    if (url.pathname === "/global/event") return new Response(new ReadableStream(), { status: 200 })
    throw new Error(`unexpected request: ${url.pathname}`)
  }) as typeof globalThis.fetch

  const [
    { DialogProvider },
    { DialogWorkflowQuestion },
    { SDKProvider },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../../src/ui/dialog"),
    import("../../../src/component/dialog-workflow-question"),
    import("../../../src/context/sdk"),
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/ui/toast"),
    import("../../../src/keymap"),
  ])

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts directory={input.root} paths={{ home: input.root, state, worktree: input.root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <SDKProvider url="http://test" directory={directory} fetch={fetchImpl}>
                    <DialogProvider>
                      <DialogWorkflowQuestion run={pausedRun()} onClose={input.onClose} />
                    </DialogProvider>
                  </SDKProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  return {
    app,
    answered,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

test("question dialog focuses the free-text textarea on open", async () => {
  await using tmp = await tmpdir()
  const q = await mountQuestion({ root: tmp.path, onClose: () => {} })
  try {
    await wait(() => q.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    expect(q.app.renderer.currentFocusedEditor).toBeInstanceOf(TextareaRenderable)
  } finally {
    await q.cleanup()
  }
})

test("typing j/k enters text in the textarea instead of navigating", async () => {
  await using tmp = await tmpdir()
  const q = await mountQuestion({ root: tmp.path, onClose: () => {} })
  try {
    await wait(() => q.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = q.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused textarea")

    await q.app.mockInput.typeText("jakke")
    expect(textarea.plainText).toBe("jakke")
  } finally {
    await q.cleanup()
  }
})

test("arrow nav selects a declared option and Enter submits it", async () => {
  await using tmp = await tmpdir()
  let closedWith: string | undefined | "unset" = "unset"
  const q = await mountQuestion({
    root: tmp.path,
    onClose: (resumeRunID) => {
      closedWith = resumeRunID
    },
  })
  try {
    await wait(() => q.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    // active starts at 0 ("alpha"); arrow down moves to "beta", a second to the
    // free-text entry, so one arrow down lands on the second declared option.
    q.app.mockInput.pressArrow("down")
    q.app.mockInput.pressEnter()

    await wait(() => q.answered.length === 1)
    expect(q.answered[0]).toEqual({ id: "job_q", body: { answer: "beta" } })
    // The run resolved in place (same id), so no resume id is followed.
    await wait(() => closedWith !== "unset")
    expect(closedWith).toBeUndefined()
  } finally {
    await q.cleanup()
  }
})
