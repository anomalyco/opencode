import type { CDPSession, Page } from "@playwright/test"
import path from "node:path"
import { mkdir, open, rename } from "node:fs/promises"
import { Buffer } from "node:buffer"
import { createHash, randomUUID } from "node:crypto"

const categories = [
  "-*",
  "devtools.timeline",
  "v8.execute",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "toplevel",
  "blink.console",
  "blink.user_timing",
  "latencyInfo",
  "disabled-by-default-devtools.timeline.stack",
  "disabled-by-default-v8.cpu_profiler",
]

export async function startChromeTrace(page: Page, name: string) {
  const directory = process.env.OPENCODE_PERFORMANCE_TRACE_DIR
  if (!directory) return

  const selectors = process.env.OPENCODE_PERFORMANCE_SELECTOR_TRACE === "1"
  const file = await prepareChromeTrace(directory, name, selectors)
  const session = await page.context().newCDPSession(page)
  try {
    await session.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      traceConfig: {
        excludedCategories: categories
          .filter((category) => category.startsWith("-"))
          .map((category) => category.slice(1)),
        includedCategories: [
          ...categories.filter((category) => !category.startsWith("-")),
          ...(selectors
            ? ["disabled-by-default-blink.debug", "disabled-by-default-devtools.timeline.invalidationTracking"]
            : []),
        ],
      },
    })
  } catch (error) {
    await Promise.allSettled([session.detach()])
    throw error
  }
  let stopping: Promise<string> | undefined

  return () =>
    (stopping ??= (async () => {
      try {
        const complete = new Promise<{ stream?: string; dataLossOccurred: boolean }>((resolve) =>
          session.once("Tracing.tracingComplete", resolve),
        )
        await session.send("Tracing.end")
        const result = await complete
        if (!result.stream) throw new Error(`Chrome trace stream missing: ${file}`)
        const partial = `${file}.partial`
        await writeProtocolStream(session, result.stream, partial)
        if (result.dataLossOccurred) throw new Error(`Chrome trace lost data; partial capture retained: ${partial}`)
        await rename(partial, file)
        return file
      } finally {
        await Promise.allSettled([session.detach()])
      }
    })())
}

export async function prepareChromeTrace(
  directory: string,
  name: string,
  selectors: boolean,
  nonce = randomUUID().slice(0, 8),
) {
  await mkdir(directory, { recursive: true })
  const run = process.env.OPENCODE_PERFORMANCE_RUN_ID ?? "manual"
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8)
  return path.join(
    directory,
    `${run}-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}-${hash}-${nonce}${selectors ? "-selectors" : ""}.json`,
  )
}

async function writeProtocolStream(session: CDPSession, handle: string, file: string) {
  const output = await open(file, "wx")
  try {
    while (true) {
      const chunk = await session.send("IO.read", { handle })
      await output.write(chunk.base64Encoded ? Buffer.from(chunk.data, "base64") : chunk.data)
      if (chunk.eof) break
    }
  } finally {
    await Promise.allSettled([output.close(), session.send("IO.close", { handle })])
  }
}
