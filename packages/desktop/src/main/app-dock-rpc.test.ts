import { spawn } from "node:child_process"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, access, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:https"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import type { DockRPCReply } from "./app-dock-rpc"

type Case = { id: string; status: "pass"; detail: string }
const required = ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11", "M01"]
const root = resolve(import.meta.dir, "../..")
const artifact = join(process.env.APP_DOCK_ARTIFACT_ROOT ?? root, "artifacts/app-dock-rpc/s1.json")
const cases: Case[] = []

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}
const pass = (id: string, detail: string) => cases.push({ id, status: "pass", detail })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "app-dock-rpc-"))
  const key = join(dir, "key.pem")
  const cert = join(dir, "cert.pem")
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-subj", "/CN=127.0.0.1", "-days", "1"],
    { stdio: "ignore" },
  )
  const body = `<!doctype html>
<title>rpc fixture</title>
<style>body{font-family:sans-serif}</style>
<div id="app">
  <button id="inc">Increment</button>
  <output id="count">0</output>
  <label for="name">Name</label>
  <input id="name" type="text" placeholder="your name" />
  <button id="fullscreen">Fullscreen</button>
</div>
<script>
  const count = document.getElementById("count")
  document.getElementById("inc").addEventListener("click", () => {
    count.textContent = String(Number(count.textContent || 0) + 1)
  })
  document.getElementById("fullscreen").addEventListener("click", () => document.documentElement.requestFullscreen?.())
</script>`
  const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", () => ready()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fixture did not bind")
  return {
    base: `https://127.0.0.1:${(address as AddressInfo).port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

type RPCEnvelope = Readonly<{ type: "dock.rpc"; id: string; op: string; args: Record<string, unknown> }>

async function child() {
  const electron = await import("electron")
  const { app, BrowserWindow } = electron
  const { createAppDock } = await import("./app-dock")
  const { handleDockRPC, registerAppDockBridge, registerAppDockProfileResolver } = await import("./app-dock-rpc")
  if (!process.versions.electron) throw new Error("Electron child not started")
  app.commandLine.appendSwitch("ignore-certificate-errors")
  await app.whenReady()
  const site = await fixture()
  const doc = createAppDock({ developmentMode: () => false })
  registerAppDockBridge(doc)
  let profileResolverCalls = 0
  let selectedStorageKey = "rpc-profile-storage"
  registerAppDockProfileResolver(() => {
    profileResolverCalls++
    return { profileID: "rpc-profile", storageKey: selectedStorageKey }
  })
  const settled = new Map<string, (result: unknown) => void>()
  const reply: DockRPCReply = (message) => {
    const result = message as { type: string; id: string }
    const resolveResult = settled.get(result.id)
    if (!resolveResult) return
    settled.delete(result.id)
    resolveResult(message)
  }
  const rpc = (op: string, args: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolveResult) => {
      const envelope: RPCEnvelope = { type: "dock.rpc", id: `test-${Math.random()}`, op, args }
      settled.set(envelope.id, resolveResult)
      const consumed = handleDockRPC(envelope, reply)
      check(consumed === true, `handleDockRPC did not consume dock.rpc: ${op}`)
    })
  try {
    const win = new BrowserWindow({ width: 900, height: 700, show: true })
    win.show()
    win.focus()
    for (let spins = 0; spins < 10 && BrowserWindow.getFocusedWindow() !== win; spins++) {
      win.focus()
      await new Promise((delay) => setTimeout(delay, 40))
    }
    check(BrowserWindow.getFocusedWindow() === win, "test window did not become focused")
    const reply1 = (await rpc("open", { address: `${site.base}/rpc` })) as Record<string, unknown>
    check(reply1.type === "dock.rpc.result" && reply1.ok === true, `open did not return ok:true (${JSON.stringify(reply1)})`)
    const tab = reply1.value as { tabID: string; url: string }
    check(tab.tabID && tab.url.startsWith("https://"), "open returned invalid tab")
    pass("R03", "open lands a real https tab through the bridge")
    check(profileResolverCalls === 1, "RPC open did not resolve active profile storage")

    const unknown = (await rpc("explode")) as { ok: boolean; error?: { message: string } }
    check(unknown.ok === false && String(unknown.error?.message).includes("explode"), "unknown op not rejected")
    pass("R01", "unknown op returns an error result")

    const http = (await rpc("open", { address: "http://127.0.0.1/blocked" })) as { ok: boolean; error?: { message: string } }
    check(http.ok === false && String(http.error?.message).includes("HTTPS"), "http open was not rejected as HTTPS-only")
    pass("R02", "non-https address rejected with HTTPS-only error")

    const list = (await rpc("list")) as { value: Array<{ tabID: string; active: boolean }> }
    check(list.ok === true && list.value.length === 1 && list.value[0].tabID === tab.tabID && list.value[0].active === true, "list did not report opened tab as active")
    pass("R04", "list reports opened tab with active flag via senderID")

    const read0 = (await rpc("read")) as { ok: boolean; value: { items: Array<{ ref: number; tag: string; name?: string }> } }
    check(read0.ok === true, "read failed")
    const refs = new Map(read0.value.items.map((item) => [item.tag, item.ref] as const))
    check(refs.has("button") && refs.has("input"), "read snapshot missing button/input refs")
    pass("R05", "read returns page snapshot refs through execute")

    const incrementRef = read0.value.items.find((item) => item.name === "Increment")?.ref
    check(typeof incrementRef === "number", "increment ref missing")
    const click = (await rpc("click", { ref: incrementRef })) as { ok: boolean; value: { ok: boolean } }
    check(click.ok === true && click.value.ok === true, `click reported failure: ${JSON.stringify(click)}`)
    const read1 = (await rpc("read")) as { ok: boolean; value: { text: string } }
    check(read1.ok === true && read1.value.text.includes("1"), "counter did not reach 1 after click")
    pass("R06", "click through bridge mutates the live page")

    const typed = (await rpc("type", { ref: refs.get("input"), text: "Ada Byron" })) as { ok: boolean; value: { value: string } }
    check(typed.ok === true && typed.value.value === "Ada Byron", "type did not set input value")
    const read2 = (await rpc("read")) as { ok: boolean; value: { items: Array<{ tag: string; value?: string }> } }
    check(read2.ok === true && read2.value.items.some((item) => item.tag === "input" && item.value === "Ada Byron"), "typed value missing from subsequent snapshot item")
    pass("R07", "type through bridge sets input and reflects in snapshot")

    const reload = (await rpc("go", { command: "reload" })) as { ok: boolean }
    check(reload.ok === true, "reload failed")
    const afterReload = (await rpc("list")) as { ok: boolean; value: Array<{ tabID: string }> }
    check(afterReload.ok === true && afterReload.value.length === 1, "tab was lost on reload")
    pass("R08", "go reload keeps the tab alive")

    await rpc("wait", { milliseconds: 100 })
    const fullscreenSnap = (await rpc("read")) as { ok: boolean; value?: { items: Array<{ ref: number; name?: string }> }; error?: unknown }
    check(fullscreenSnap.ok === true && fullscreenSnap.value, `fullscreen read failed: ${JSON.stringify(fullscreenSnap)}`)
    const fullscreenRef = fullscreenSnap.value.items.find((item) => item.name === "Fullscreen")?.ref
    check(typeof fullscreenRef === "number", "fullscreen ref missing")
    await rpc("click", { ref: fullscreenRef })
    await rpc("wait", { milliseconds: 100 })
    const entered = (await rpc("evaluate", { script: "Boolean(document.fullscreenElement)" })) as { value: { result: string } }
    check(entered.value.result === "true", `fullscreen entry was not observed: ${JSON.stringify(entered)}`)
    const escape = (await rpc("keyboard", { type: "keyDown", key: "Escape" })) as { ok: boolean; value: { ok: boolean; key: string } }
    check(escape.ok === true && escape.value.ok === true && escape.value.key === "Escape", `Escape keyboard path failed: ${JSON.stringify(escape)}`)
    await rpc("wait", { milliseconds: 100 })
    const exited = (await rpc("evaluate", { script: "Boolean(document.fullscreenElement)" })) as { value: { result: string } }
    check(exited.value.result === "false", `fullscreen exit was not observed: ${JSON.stringify(exited)}`)
    pass("R11", "Escape keyboard path completes without stale fullscreen state")

    const marker = await rpc("evaluate", { script: "localStorage.setItem('profile-marker', 'active'); true" })
    check(marker && typeof marker === "object" && "ok" in marker && marker.ok === true, "profile marker write failed")
    await rpc("close")
    selectedStorageKey = "rpc-other-profile-storage"
    await rpc("open", { address: `${site.base}/rpc` })
    const isolated = (await rpc("storage", { storage: "local", key: "profile-marker" })) as { value: { value: string | null } }
    check(isolated.value.value === null, `profile storage leaked across resolver switch: ${JSON.stringify(isolated)}`)
    pass("R10", "RPC profile resolver isolates storage between profiles")

    const closed = (await rpc("close")) as { value: unknown[] }
    check(closed.ok === true && closed.value.length === 0, "close did not empty the tab list")
    pass("R09", "close empties the tab list")

    const foreign = handleDockRPC({ type: "not-dock", body: 1 }, reply)
    check(foreign === false, "non-dock message should be ignored")
    pass("M01", "non-dock message ignored")

    if (!win.isDestroyed()) win.destroy()
    await writeFile(artifact, JSON.stringify({ version: 1, electronVersion: process.versions.electron, cases }, null, 2))
  } catch (error) {
    console.error(JSON.stringify({ phase: "app-dock-rpc-child-failure", error: String(error) }))
    await mkdir(dirname(artifact), { recursive: true })
    await writeFile(artifact, JSON.stringify({ version: 1, electronVersion: process.versions.electron, cases, error: String(error) }, null, 2))
    throw error
  } finally {
    await site.close()
    app.exit(cases.length === required.length && required.every((id) => cases.some((item) => item.id === id)) ? 0 : 1)
  }
}

async function parent() {
  const buildDir = await mkdtemp(join(tmpdir(), "app-dock-rpc-e2e-"))
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
    check(result.success && result.outputs?.[0], "bundle failed")
    const entry = join(dirname(result.outputs![0].path), "app-dock-rpc.test.cjs")
    await access(entry)
    const electronModule = createRequire(join(process.cwd(), "package.json")).resolve("electron")
    const electron = join(dirname(electronModule), "dist/Electron.app/Contents/MacOS/Electron")
    await access(electron)
    const env = { ...process.env, APP_DOCK_ARTIFACT_ROOT: root, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" }
    await rm(artifact, { force: true })
    const child = spawn(electron, [entry, "--app-dock-rpc-child"], { stdio: ["ignore", "pipe", "pipe"], env })
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
      "invalid app-dock-rpc artifact",
    )
  } finally {
    await rm(buildDir, { recursive: true, force: true })
  }
}

if (process.argv.includes("--app-dock-rpc-child"))
  void child().catch(async (error) => {
    console.error(error)
    process.exit(1)
  })
else
  void parent().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
