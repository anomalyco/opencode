import { base64Encode } from "@opencode-ai/util/encode"
import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectSessionTitle } from "../../utils/waits"
import { fixture } from "./session-timeline-stress.fixture"

const sessionID = "ses_composer_write_batch"
const title = "Composer persistence workload"
const addition = " Keep the existing error handling and add coverage."
const text =
  Array.from(
    { length: 180 },
    (_, index) =>
      `Review requirement ${index + 1}: preserve request ordering in src/queue/worker-${index % 12}.ts. ` +
      `A failed request must retain its payload, report its cause, and remain safe to retry.\n` +
      `Expected: await queue.flush(); expect(await repository.read(id)).toEqual(accepted);\n`,
  ).join("") + "Implementation notes:"
const items = Array.from({ length: 8 }, (_, index) => ({
  type: "file",
  path: `src/queue/worker-${index}.ts`,
  selection: { startLine: 10, startChar: 0, endLine: 24, endChar: 0 },
  commentID: `composer-write-batch-${index}`,
  comment: `Check retry path ${index}: keep the original request identity and error cause.`,
  preview: Array.from(
    { length: 24 },
    (_, line) => `  const request${line} = await repository.loadPending("queue-${index}");`,
  ).join("\n"),
}))
const document = {
  prompt: [{ type: "text", content: text, start: 0, end: text.length }],
  cursor: text.length,
  mode: "normal",
  context: { items },
}
type Probe = { active: boolean; encodes: number; bytes: number; inputs: number; keyups: number }
type ProbeWindow = typeof window & { composerWriteBatch: Probe }

benchmark.use({
  viewport: { width: 1440, height: 900 },
  video: "off",
  trace: "off",
  serviceWorkers: "block",
  traceScope: "interaction",
})

for (const scenario of ["typing", "cursor-movement", "cursor-noop", "submit-cleanup"] as const) {
  benchmark(`composer-write-batch: ${scenario}`, async ({ page, report }, testInfo) => {
    const submitted: Record<string, unknown>[] = []
    await mockOpenCodeServer(page, {
      directory: fixture.directory,
      project: fixture.project,
      provider: fixture.provider,
      sessions: [{ ...fixture.sessions[0], id: sessionID, title }],
      pageMessages: () => ({ items: [] }),
      onPrompt: (input) => submitted.push(input.body),
    })
    await page.addInitScript(
      ({ key, value, counts }) => {
        localStorage.setItem(key, JSON.stringify(value))
        const probe: Probe = { active: false, encodes: 0, bytes: 0, inputs: 0, keyups: 0 }
        ;(window as ProbeWindow).composerWriteBatch = probe
        // The draft adapter parses each schema-encoded composer document once before
        // its asynchronous blob walk. Count at this boundary, not at the IDB write
        // (which already discards superseded writes). This fixture is ASCII only.
        if (counts) {
          const parse = JSON.parse
          JSON.parse = (value, reviver) => {
            if (probe.active && typeof value === "string" && value.startsWith('{"prompt":[')) {
              probe.encodes++
              probe.bytes += value.length
            }
            return parse(value, reviver)
          }
        }
        window.addEventListener("input", (event) => {
          if (
            probe.active &&
            event.target instanceof Element &&
            event.target.matches('[data-component="composer-editor"]')
          )
            probe.inputs++
        })
        window.addEventListener("keyup", (event) => {
          if (
            probe.active &&
            event.target instanceof Element &&
            event.target.matches('[data-component="composer-editor"]')
          )
            probe.keyups++
        })
      },
      {
        key: `${base64Encode(fixture.directory)}/prompt/${sessionID}.v2`,
        value: document,
        counts: process.env.OPENCODE_PERSISTENCE_COUNTS === "1",
      },
    )
    const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    const editor = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(editor).toBeEditable()
    await expect(editor).toHaveText(text)
    await editor.focus()
    await editor.press("ControlOrMeta+End")
    await page.evaluate(() => window.document.fonts.ready)
    const stored = async () =>
      page.evaluate(async (sessionID) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("opencode-drafts", 1)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          const transaction = db.transaction("documents")
          const keys = transaction.objectStore("documents").getAllKeys()
          const values = transaction.objectStore("documents").getAll()
          await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve()
            transaction.onerror = () => reject(transaction.error)
          })
          const index = keys.result.findIndex((key) => String(key).endsWith(`session:${sessionID}:prompt`))
          // Parse after disabling the count so the observation is not part of it.
          const probe = (window as ProbeWindow).composerWriteBatch
          const active = probe.active
          probe.active = false
          const value = index < 0 ? undefined : JSON.parse(values.result[index])
          probe.active = active
          return value as { prompt: { content: string }[]; cursor: number; context: { items: unknown[] } } | undefined
        } finally {
          db.close()
        }
      }, sessionID)
    await expect.poll(async () => (await stored())?.cursor).toBe(text.length)
    expect((await stored())?.context.items).toHaveLength(items.length)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")
    await benchmarkDiagnostics(page).startTrace()
    const before = await cdp.send("Performance.getMetrics")
    await page.evaluate(() => {
      ;(window as ProbeWindow).composerWriteBatch.active = true
      performance.mark("composer-write-batch-start")
    })
    const start = performance.now()
    if (scenario === "typing") await editor.pressSequentially(addition)
    if (scenario === "cursor-movement") await editor.press("ArrowLeft")
    if (scenario === "cursor-noop") await editor.press("ArrowRight")
    if (scenario === "submit-cleanup") await editor.press("Enter")
    const expectedText = scenario === "typing" ? text + addition : scenario === "submit-cleanup" ? "" : text
    const expectedCursor =
      scenario === "typing"
        ? text.length + addition.length
        : scenario === "submit-cleanup"
          ? 0
          : text.length - Number(scenario === "cursor-movement")
    await expect(editor).toHaveText(expectedText)
    await expect.poll(async () => (await stored())?.cursor).toBe(expectedCursor)
    const elapsedMs = performance.now() - start
    const after = await cdp.send("Performance.getMetrics")
    const probe = await page.evaluate(() => {
      performance.mark("composer-write-batch-end")
      const probe = (window as ProbeWindow).composerWriteBatch
      probe.active = false
      return probe
    })
    expect((await stored())?.prompt.map((part) => part.content).join("")).toBe(expectedText)
    if (scenario === "submit-cleanup") {
      await expect.poll(() => submitted.length).toBe(1)
      expect(submitted[0].text).toContain(text)
      expect((await stored())?.context.items).toHaveLength(0)
    }
    expect(probe.keyups).toBe(scenario === "typing" ? addition.length : 1)
    expect(probe.inputs).toBe(scenario === "typing" ? addition.length : 0)
    const metric = (name: string) =>
      1000 *
      ((after.metrics.find((x) => x.name === name)?.value ?? 0) -
        (before.metrics.find((x) => x.name === name)?.value ?? 0))
    report(
      { elapsedMs, taskMs: metric("TaskDuration"), scriptMs: metric("ScriptDuration"), ...probe },
      {
        scenario,
        promptBytes: Buffer.byteLength(text),
        contextItems: items.length,
        persistedBytes: Buffer.byteLength(JSON.stringify(document)),
        typedCharacters: scenario === "typing" ? addition.length : 0,
        counts: process.env.OPENCODE_PERSISTENCE_COUNTS === "1",
        browser: page.context().browser()!.version(),
        build: process.env.OPENCODE_PERSISTENCE_BUILD,
        transport: "playwright-route",
        completion: "editor text and committed IDB cursor",
      },
    )
    await benchmarkDiagnostics(page).stop()
    await cdp.detach()
    if (testInfo.repeatEachIndex === 0) await page.screenshot({ path: testInfo.outputPath(`${scenario}.png`) })
  })
}
