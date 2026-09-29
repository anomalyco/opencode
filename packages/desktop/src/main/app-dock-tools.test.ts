import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, access, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { buildSnapshotScript, buildClickScript, buildTypeScript } from "./app-dock-browser"

type Case = { id: string; status: "pass"; detail: string }
const required = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"]
const root = resolve(import.meta.dir, "../..")
const artifact = join(process.env.APP_DOCK_ARTIFACT_ROOT ?? root, "artifacts/app-dock-tools/s1.json")
const cases: Case[] = []

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}
const pass = (id: string, detail: string) => cases.push({ id, status: "pass", detail })

function fixture() {
  const body = `<!doctype html>
<title>app dock tools fixture</title>
<style>body{font-family:sans-serif}</style>
<div id="app">
  <button id="inc">Increment</button>
  <output id="count">0</output>
  <a id="link" href="#value">Jump link</a>
  <label for="name">Name</label>
  <input id="name" type="text" placeholder="your name" />
  <textarea id="bio" rows="2">default bio</textarea>
  <div id="editable" contenteditable="true">edit me</div>
  <button id="hidden" hidden>hidden button</button>
  <button id="inert" aria-hidden="true">inert button</button>
</div>
<script>
  const count = document.getElementById("count")
  document.getElementById("inc").addEventListener("click", () => {
    count.textContent = String(Number(count.textContent || 0) + 1)
  })
  let inputs = 0
  let changes = 0
  const record = (kind) => (event) => {
    if (kind === "input") inputs += 1
    if (kind === "change") changes += 1
    window.__events = { inputs, changes }
  }
  const name = document.getElementById("name")
  name.addEventListener("input", record("input"))
  name.addEventListener("change", record("change"))
</script>`
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  return new Promise<{ base: string; close: () => Promise<void> }>((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("fixture did not bind")
      resolveServer({
        base: `http://127.0.0.1:${(address as AddressInfo).port}`,
        close: () => new Promise((closeDone) => server.close(() => closeDone())),
      })
    })
  })
}

async function child() {
  const { app, BrowserWindow } = await import("electron")
  if (!process.versions.electron) throw new Error("Electron child not started")
  await app.whenReady()
  if (!process.env.APP_DOCK_ARTIFACT_ROOT || !isAbsolute(process.env.APP_DOCK_ARTIFACT_ROOT))
    throw new Error("Invalid App Dock artifact root")
  const site = await fixture()
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  })
  try {
    await win.loadURL(`${site.base}/fixture`)
    await win.webContents.executeJavaScript(
      "document.readyState === 'complete' && !!document.getElementById('inc')",
    )

    const snapshot = await win.webContents.executeJavaScript(buildSnapshotScript())
    const byRef = new Map<number, string>((snapshot.items as Array<{ ref: number; name: string; tag: string }>).map((item) => [item.ref, item.tag]))
    const tags = Array.from(byRef.values())
    check(isSnapshotWith(snapshot), "snapshot lacks expected shape")
    check(tags.includes("button") && tags.includes("input") && tags.includes("a") && tags.includes("div"), "expected element kinds missing")
    check(!Array.from(byRef.keys()).some((ref) => !Number.isInteger(ref) || ref < 1), "refs are not positive integers")
    check(!Array.from(byRef.keys()).some((ref) => !byRef.has(ref)), "duplicate ref assigned")
    pass("T01", "snapshot lists interactive elements with unique positive refs")

    const capped = await win.webContents.executeJavaScript(buildSnapshotScript({ budget: 3 }))
    check((capped.items as unknown[]).length <= 3, "budget cap not honored")
    check(capped.truncated === true, "truncated flag not set under budget")
    pass("T02", "budget clamps item count and sets truncated")

    const again = await win.webContents.executeJavaScript(buildSnapshotScript())
    const was = Array.from(byRef.keys()).find((ref) => byRef.get(ref) === "button")
    check(was !== undefined, "button ref not found in first snapshot")
    const is = (again.items as Array<{ ref: number; tag: string }>).find((item) => item.tag === "button")
    check(is !== undefined && is.ref === was, "button ref changed between snapshots")
    pass("T03", "ref is stable across repeated snapshots")

    const clickResult = await win.webContents.executeJavaScript(buildClickScript(was!))
    check(clickResult && clickResult.ok === true, "click reported failure")
    const countText = await win.webContents.executeJavaScript("document.getElementById('count').textContent")
    check(countText === "1", "click did not increment counter")
    pass("T04", "click dispatches working pointer/mouse sequence")

    const typed = await win.webContents.executeJavaScript(buildTypeScript(byRefName(again, "input"), "Ada"))
    check(typed && typed.ok === true && typed.value === "Ada", "typed value not set on input")
    const events = await win.webContents.executeJavaScript("window.__events")
    check(events && events.inputs >= 1 && events.changes >= 1, "native setter did not fire input/change")
    pass("T05", "type sets input via native setter and fires events")

    const content = await win.webContents.executeJavaScript(buildTypeScript(byRefName(again, "textarea"), "author bio"))
    check(content && content.ok === true, "textarea type reported failure")
    const bio = await win.webContents.executeJavaScript("document.getElementById('bio').value")
    check(bio === "author bio", "textarea value not replaced")

    const editableResult = await win.webContents.executeJavaScript(buildTypeScript(byRefName(again, "div"), "new note"))
    check(editableResult && editableResult.ok === true, "contenteditable type reported failure")
    const edited = await win.webContents.executeJavaScript("document.getElementById('editable').textContent")
    check(edited === "new note", "contenteditable text not set")
    pass("T06", "type handles textarea and contenteditable targets")

    const removedRef = byRefName(again, "a")
    await win.webContents.executeJavaScript("document.getElementById('link').remove()")
    const stale = await win.webContents.executeJavaScript(buildClickScript(removedRef))
    check(stale && stale.ok === false && String(stale.error).includes("gone"), "stale ref not reported as gone")
    pass("T07", "stale ref after removal fails with gone")

    const hiddenKinds = (again.items as Array<{ name: string }>).map((item) => item.name)
    check(!hiddenKinds.includes("hidden button") && !hiddenKinds.includes("inert button"), "hidden/inert elements leaked into snapshot")
    pass("T08", "hidden and aria-hidden inert elements excluded")

    await mkdir(dirname(artifact), { recursive: true })
    await writeFile(
      artifact,
      JSON.stringify({ version: 1, electronVersion: process.versions.electron, cases }, null, 2),
    )
  } catch (error) {
    console.error(JSON.stringify({ phase: "app-dock-tools-child-failure", error: String(error) }))
    await mkdir(dirname(artifact), { recursive: true })
    await writeFile(artifact, JSON.stringify({ version: 1, electronVersion: process.versions.electron, cases, error: String(error) }, null, 2))
    throw error
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await site.close()
    app.exit(cases.length === required.length && required.every((id) => cases.some((item) => item.id === id)) ? 0 : 1)
  }
}

function isSnapshotWith(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false
  const state = snapshot as { url: unknown; title: unknown; viewport: unknown; items: unknown; text: unknown }
  return (
    typeof state.url === "string" &&
    typeof state.title === "string" &&
    typeof state.viewport === "object" &&
    Array.isArray(state.items) &&
    typeof state.text === "string"
  )
}

function byRefName(snapshot: { items: Array<{ ref: number; tag: string }> }, tag: string): number {
  const found = snapshot.items.find((item) => item.tag === tag)
  check(found !== undefined, `no ${tag} in snapshot`)
  return found!.ref
}

async function parent() {
  const buildDir = await mkdtemp(join(tmpdir(), "app-dock-tools-e2e-"))
  try {
    const result = await Bun.build({
      entrypoints: [import.meta.path],
      outdir: buildDir,
      naming: "[name].cjs",
      target: "node",
      format: "cjs",
      external: ["electron"],
      write: true,
    })
    check(result.success && result.outputs[0], "bundle failed")
    const entry = join(outdirOf(result), "app-dock-tools.test.cjs")
    await access(entry)
    const electronModule = createRequire(join(process.cwd(), "package.json")).resolve("electron")
    const electron = join(dirname(electronModule), "dist/Electron.app/Contents/MacOS/Electron")
    await access(electron)
    const env = { ...process.env, APP_DOCK_ARTIFACT_ROOT: root, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" }
    await rm(artifact, { force: true })
    const child = spawn(electron, [entry, "--app-dock-tools-child"], { stdio: ["ignore", "pipe", "pipe"], env })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const exitResult = await new Promise<{ code: number | null }>((resolveProcess, reject) => {
      child.once("exit", (code) => resolveProcess({ code }))
      child.once("error", reject)
    })
    if (exitResult.code !== 0) throw new Error(`child failed (${exitResult.code}): ${stderr}`)
    const report = JSON.parse(await readFile(artifact, "utf8"))
    check(
      report.version === 1 &&
        Array.isArray(report.cases) &&
        report.cases.length === required.length &&
        required.every((id) => report.cases.some((item: Case) => item.id === id && item.status === "pass")),
      "invalid app-dock-tools artifact",
    )
  } finally {
    await rm(buildDir, { recursive: true, force: true })
  }
}

function outdirOf(result: { outputs?: Array<{ path: string }> }): string {
  return dirname(result.outputs?.[0]?.path ?? ".")
}

if (process.argv.includes("--app-dock-tools-child"))
  void child().catch(async (error) => {
    console.error(error)
    process.exit(1)
  })
else
  void parent().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })