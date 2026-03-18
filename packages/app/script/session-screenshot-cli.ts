import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "@playwright/test"

const root = path.resolve(import.meta.dir, "..")
const out = path.join(root, ".tmp", "session-screenshot-cli")
const entry = path.join(out, "entry.ts")
const html = path.join(out, "index.html")
const mod = path.join(root, "src", "pages", "session", "session-screenshot.ts").replaceAll("\\", "\\\\")
const arg = process.argv[2]
const files = arg
  ? [path.resolve(process.cwd(), arg)]
  : [
      path.join(root, "script", "session-screenshot-fixture.json"),
      path.join(root, "script", "session-screenshot-fixture-real.json"),
    ]
const shots = await Promise.all(
  files.map(async (file) => {
    const json = await readFile(file, "utf8")
    return {
      file,
      name: `${path.basename(file, ".json")}.png`,
      json,
    }
  }),
)

const src = `
import { createSessionScreenshot } from "${mod}"

const shots = ${JSON.stringify(shots)}

try {
  window.__SHOT__ = []
  for (const shot of shots) {
    const input = JSON.parse(shot.json)
    const blob = await createSessionScreenshot({
      sessionID: input.sessionID,
      title: input.title,
      dir: input.dir,
      messages: input.messages,
      parts: (id) => input.parts[id] ?? [],
      revert: input.revert,
    })

    window.__SHOT__.push({
      name: shot.name,
      data: await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error ?? new Error("read failed"))
        reader.onload = () => resolve(String(reader.result))
        reader.readAsDataURL(blob)
      }),
    })
  }
  document.body.dataset.ready = "true"
} catch (err) {
  document.body.dataset.error = err instanceof Error ? err.message : String(err)
  throw err
}
`

const page = `<!doctype html>
<html>
  <body>
    <script type="module" src="./entry.js"></script>
  </body>
</html>
`

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await writeFile(entry, src)
await writeFile(html, page)

const result = await Bun.build({
  entrypoints: [entry],
  outdir: out,
  target: "browser",
  format: "esm",
  sourcemap: "external",
  minify: false,
})

if (!result.success) {
  throw new Error(result.logs.map((log) => log.message).join("\n"))
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url)
    const file = path.join(out, url.pathname === "/" ? "index.html" : url.pathname.slice(1))
    return new Response(Bun.file(file))
  },
})

const browser = await chromium.launch({ headless: true })

try {
  const tab = await browser.newPage()
  tab.on("console", (msg) => console.log(msg.text()))
  tab.on("pageerror", (err) => console.error(err.message))
  await tab.goto(server.url.toString())
  try {
    await tab.waitForFunction(() => document.body.dataset.ready === "true", undefined, { timeout: 10_000 })
  } catch {
    const err = await tab.evaluate(() => document.body.dataset.error ?? "Missing screenshot data")
    throw new Error(err)
  }
  const data = await tab.evaluate(() => window.__SHOT__)
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Missing screenshot data")
  }

  for (const item of data) {
    if (!item || typeof item.name !== "string" || typeof item.data !== "string") {
      throw new Error("Invalid screenshot data")
    }
    if (!item.data.startsWith("data:image/png;base64,")) {
      throw new Error("Missing screenshot data")
    }
    const png = path.join(out, item.name)
    await writeFile(png, Buffer.from(item.data.replace("data:image/png;base64,", ""), "base64"))
    console.log(png)
  }
} finally {
  await browser.close()
  server.stop(true)
}

declare global {
  interface Window {
    __SHOT__?: { name: string; data: string }[]
  }
}
