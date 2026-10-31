import { base64Encode } from "@opencode/util/encode"
import type { Page } from "@playwright/test"
import { sessionHref } from "../../e2e/utils/app"
import { mockOpenCodeServer } from "../../e2e/utils/mock-server"
import { fixture } from "../../e2e/utils/session-fixture"

const sessionID = "ses_perf_composer"

/** The large draft's last words: the caret starts after them. */
export const draftEnd = "Implementation notes:"

/**
 * An empty session whose saved draft is large: 180 review requirements (44,223 characters) and 8 commented file
 * selections with 24-line previews, 58 KB as saved. The draft sits under the composer's previous storage key, which
 * the app moves into its draft store on load. Every keystroke and caret move saves the draft again.
 */
export async function mockLargeDraft(page: Page, server: string) {
  const text =
    Array.from(
      { length: 180 },
      (_, index) =>
        `Review requirement ${index + 1}: preserve request ordering in src/queue/worker-${index % 12}.ts. ` +
        `A failed request must retain its payload, report its cause, and remain safe to retry.\n` +
        `Expected: await queue.flush(); expect(await repository.read(id)).toEqual(accepted);\n`,
    ).join("") + draftEnd

  const items = Array.from({ length: 8 }, (_, index) => ({
    type: "file",
    path: `src/queue/worker-${index}.ts`,
    selection: { startLine: 10, startChar: 0, endLine: 24, endChar: 0 },
    commentID: `perf-composer-${index}`,
    comment: `Check retry path ${index}: keep the original request identity and error cause.`,
    preview: Array.from(
      { length: 24 },
      (_, line) => `  const request${line} = await repository.loadPending("queue-${index}");`,
    ).join("\n"),
  }))

  await mockOpenCodeServer(page, {
    server,
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [{ ...fixture.sessions[0], id: sessionID, title: "Composer persistence workload" }],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: `${base64Encode(fixture.directory)}/prompt/${sessionID}.v2`,
    value: {
      prompt: [{ type: "text", content: text, start: 0, end: text.length }],
      cursor: text.length,
      mode: "normal",
      context: { items },
    },
  })

  return { path: sessionHref(sessionID, server) }
}

/** The newest history entry's first sentence, which the first ArrowUp recalls. */
export const recalled = "Review the retry policy in src/network/request-0.ts."

/**
 * A long prompt history in the browser's draft store: 100 prompts of about 460 characters with a code fence, every
 * other one with a 1440×900 screenshot (five distinct images), and 100 shell commands. Seeded on the app's origin
 * before the app first opens the store, from a static file so the app does not start.
 */
export async function seedHistory(page: Page, origin: string) {
  await page.goto(new URL("/favicon.svg", origin).href)
  await page.evaluate(async () => {
    const normal = Array.from({ length: 100 }, (_, index) => {
      const content =
        `Review the retry policy in src/network/request-${index}.ts. Preserve cancellation and the existing error messages.\n\n` +
        `The request should stop after three attempts. Add coverage for a 429 response, a connection reset, and a successful retry. Verify that only idempotent requests are retried.\n\n` +
        `Report ${index}:\n\`\`\`ts\nexport async function request(input: Request) {\n  const response = await fetch(input)\n  if (!response.ok) throw new Error(response.statusText)\n  return response.json()\n}\n\`\`\``

      return {
        prompt: [
          { type: "text", content, start: 0, end: content.length },
          ...(index % 2 === 0
            ? [
                {
                  type: "image",
                  id: `attachment-${index}`,
                  filename: `request-${index}.png`,
                  mime: "image/png",
                  blob: { id: `screenshot-${index % 10}` },
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

    const screenshots = await Promise.all(
      [0, 2, 4, 6, 8].map(async (index) => {
        const id = `screenshot-${index}`
        const canvas = new OffscreenCanvas(1440, 900)
        const context = canvas.getContext("2d")!
        context.fillStyle = "#15191f"
        context.fillRect(0, 0, 1440, 900)
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

        return { id, blob: await canvas.convertToBlob({ type: "image/png" }) }
      }),
    )

    const open = indexedDB.open("opencode-drafts", 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore("documents")
      open.result.createObjectStore("blobs")
    }

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })

    const transaction = db.transaction(["documents", "blobs"], "readwrite")
    transaction.objectStore("documents").put(JSON.stringify({ entries: normal }), "opencode.global.dat:prompt-history")
    transaction
      .objectStore("documents")
      .put(JSON.stringify({ entries: shell }), "opencode.global.dat:prompt-history-shell")
    screenshots.forEach((screenshot) => transaction.objectStore("blobs").put(screenshot.blob, screenshot.id))
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  })
}
