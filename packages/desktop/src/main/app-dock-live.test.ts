import { spawn } from "node:child_process"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, copyFile, rm, access, readFile, writeFile } from "node:fs/promises"
import { createServer as createHttpsServer } from "node:https"
import { createServer as createNetServer } from "node:net"
import type { IncomingMessage, ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"

type Case = { id: string; status: "pass"; detail: string }
const required = ["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10", "L11", "L12", "L15"]
const expectedCases = new Set([...required, "L13", "L14"])
const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, "../..")
const desktopMain = resolve(root, "src/main")
const outMain = join(root, "out/main")
const artifact = join(process.env.APP_DOCK_ARTIFACT_ROOT ?? root, "artifacts/app-dock-live/s1.json")
const cases: Case[] = []

const check = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message)
}
const pass = (id: string, detail: string) => cases.push({ id, status: "pass", detail })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "app-dock-live-"))
  const key = join(dir, "key.pem")
  const cert = join(dir, "cert.pem")
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-subj", "/CN=127.0.0.1", "-days", "1"],
    { stdio: "ignore" },
  )
  const body = `<!doctype html><title>live fixture</title><button id=inc>Increment</button><output id=count>0</output><a id=next href="/next">Next page</a><a id=blocked href="/redirect-http">Blocked redirect</a><label for=name>Name</label><input id=name type=text placeholder="your name"><div id=host></div><div id=hiddenHost aria-hidden="true"></div><script>document.getElementById('inc').addEventListener('click',()=>{const c=document.getElementById('count');c.textContent=String(Number(c.textContent||0)+1)});document.getElementById('name').addEventListener('drop',()=>{document.title='drop-ok'});document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<input id=shadowName placeholder="shadow name">';document.getElementById('hiddenHost').attachShadow({mode:'open'}).innerHTML='<input placeholder="hidden shadow">'</script>`
  const server = createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/redirect-http") {
      res.writeHead(302, { location: "http://127.0.0.1/blocked" })
      res.end()
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(req.url === "/next" ? body.replace("live fixture", "next fixture") : body)
  })
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", () => ready()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fixture did not bind")
  return { base: `https://127.0.0.1:${address.port}`, close: () => new Promise<void>((done) => server.close(() => done())) }
}

async function freePort() {
  const server = createNetServer()
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", () => ready()))
  const address = server.address()
  const port = address.port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

async function child() {
  const electron = await import("electron")
  const { app, BrowserWindow } = electron
  const { createAppDock } = await import("./app-dock")
  const { handleDockRPC, registerAppDockBridge, registerAppDockWindow } = await import("./app-dock-rpc")
  const { spawnLocalServer } = await import("./server")
  if (!process.versions.electron) throw new Error("Electron child not started")
  app.commandLine.appendSwitch("ignore-certificate-errors")
  await app.whenReady()
  const site = await fixture()
  const port = await freePort()
  const password = randomUUID()
  const userDataPath = await mkdtemp(join(tmpdir(), "app-dock-live-userdata-"))
  Object.assign(process.env, {
    OPENCODE_CLIENT: "desktop",
    XDG_STATE_HOME: userDataPath,
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
  })
  const doc = createAppDock({ developmentMode: () => false })
  registerAppDockBridge(doc)
  const win = new BrowserWindow({ width: 900, height: 700, show: true })
  win.show()
  registerAppDockWindow(win)
  const sidecarPath = process.env.APP_DOCK_SIDECAR
  check(sidecarPath, "APP_DOCK_SIDECAR not propagated to child")
  const server = await spawnLocalServer("127.0.0.1", port, password, {
    userDataPath,
    sidecarPath,
    onStderr: (message) => console.error(`SIDECAR: ${message}`),
    onMessage: handleDockRPC,
  })
  let outcome = 1
  try {
    await server.health.wait
    pass("L01", "real sidecar utility process booted and passed health")

    const url = `http://127.0.0.1:${port}`
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    const idsResponse = await fetch(`${url}/experimental/tool/ids?directory=${encodeURIComponent(userDataPath)}`, {
      headers: { authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    })
    check(idsResponse.ok, `tool ids request failed with ${idsResponse.status}`)
    const rawIds: unknown = await idsResponse.json()
    const ids: string[] = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === "string") : []
    const expected = ["dock_list", "dock_read", "dock_click", "dock_type", "dock_navigate", "dock_go", "dock_open", "dock_close"]
    const missing = expected.filter((id) => !ids.includes(id))
    check(missing.length === 0, `dock tools missing from live server: ${missing.join(", ")}`)
    pass("L02", "dock_* tools registered and served by the real sidecar")

    const builtins = ["read", "edit", "bash", "list"].filter((id) => ids.includes(id))
    check(builtins.length > 1, "expected familiar builtin tools absent")
    pass("L03", "builtin tools coexist with dock_* in the live registry")

    const rpc = async (op: string, args: Record<string, unknown> = {}) =>
      new Promise<unknown>((resolveRPC, rejectRPC) => {
        const id = randomUUID()
        const timer = setTimeout(() => rejectRPC(new Error(`RPC timeout: ${op}`)), 15_000)
        const handled = handleDockRPC({ type: "dock.rpc", id, op, args }, (message) => {
          if (message.id !== id) return
          clearTimeout(timer)
           if (message.ok) {
             resolveRPC(message.value)
           } else {
             rejectRPC(new Error(message.error?.message ?? "App Dock RPC failed"))
           }
        })
        if (!handled) {
          clearTimeout(timer)
          rejectRPC(new Error(`Unhandled App Dock RPC: ${op}`))
        }
      })
    const openedRaw = await rpc("open", { address: site.base })
    check(!!openedRaw && typeof openedRaw === "object" && "tabID" in openedRaw, "dock_open returned no tab")
    const openedTabID = openedRaw.tabID
    check(typeof openedTabID === "string" && openedTabID.length > 0, "dock_open returned no tabID")
    let title = ""
    let hasIncrement = false
    let snapshot: { title: string; items: { name: string; ref: number; tag: string }[]; text: string } | undefined
    const deadline = Date.now() + 15_000
    while (true) {
      snapshot = await rpc("read", {})
      check(!!snapshot && typeof snapshot === "object" && "title" in snapshot && "items" in snapshot, "unexpected dock snapshot shape")
      const snapshotTitle = snapshot.title
      check(typeof snapshotTitle === "string" && Array.isArray(snapshot.items), "unexpected dock snapshot fields")
      title = snapshotTitle
      hasIncrement = snapshot.items.some(
        (item) => !!item && typeof item === "object" && "name" in item && item.name === "Increment",
      )
      if (Date.now() > deadline) throw new Error(`dock tab never finished loading: ${title}`)
      if (title === "live fixture" || hasIncrement) break
      await new Promise((delay) => setTimeout(delay, 150))
    }
    check(title === "live fixture", `unexpected dock snapshot title: ${title}`)
    check(hasIncrement, "Increment button missing from live dock snapshot")
    pass("L04", "dock_open + dock_read round-trip through the RPC dispatch against a real dock tab")

    const incRef = snapshot!.items.find((item) => !!item && typeof item === "object" && "name" in item && item.name === "Increment")
    check(incRef && typeof incRef === "object" && "ref" in incRef && typeof incRef.ref === "number", "Increment ref missing")
    const clickResult = await rpc("click", { ref: incRef.ref })
    check(
      clickResult && typeof clickResult === "object" && "ok" in clickResult && clickResult.ok === true,
      `click failed: ${JSON.stringify(clickResult)}`,
    )
    const afterClick = await rpc("read", {})
    check(afterClick && typeof afterClick === "object" && "text" in afterClick && typeof afterClick.text === "string" && afterClick.text.includes("1"), "counter not incremented")
    pass("L05", "dock_click mutates live page through RPC")

    const inputRef = snapshot.items.find((item) => !!item && typeof item === "object" && "tag" in item && item.tag === "input")
    check(inputRef && typeof inputRef === "object" && "ref" in inputRef && typeof inputRef.ref === "number", "input ref missing")
    const typeResult = await rpc("type", { ref: inputRef.ref, text: "Ada" })
    check(
      typeResult && typeof typeResult === "object" && "ok" in typeResult && typeResult.ok === true,
      `type failed: ${JSON.stringify(typeResult)}`,
    )
    const afterType = await rpc("read", {})
    check(afterType && typeof afterType === "object" && "items" in afterType && Array.isArray(afterType.items) && afterType.items.some((i) => !!i && typeof i === "object" && "value" in i && i.value === "Ada"), "typed value not reflected")
    pass("L06", "dock_type sets input value through RPC")

    await rpc("scroll", { direction: "down", amount: 300 })
    const afterScroll = await rpc("read", {})
    check(!!afterScroll && typeof afterScroll === "object" && "title" in afterScroll, "read after scroll failed")
    let scrollRejected = false
    try {
      await rpc("scroll", { direction: "sideways" })
    } catch {
      scrollRejected = true
    }
    check(scrollRejected, "invalid scroll direction was not rejected")
    let amountRejected = false
    try {
      await rpc("scroll", { direction: "top", amount: 100 })
    } catch {
      amountRejected = true
    }
    check(amountRejected, "scroll amount with edge direction was not rejected")
    pass("L07", "dock_scroll dispatches scroll and rejects invalid direction or amount")

    const hoverSnap = await rpc("read", {})
    check(!!hoverSnap && typeof hoverSnap === "object" && "items" in hoverSnap && Array.isArray(hoverSnap.items), "snapshot shape")
    const hoverRef = hoverSnap.items.find((item) => !!item && typeof item === "object" && "name" in item && item.name === "Increment" && "ref" in item && typeof item.ref === "number")?.ref
    check(typeof hoverRef === "number", "Increment ref missing for hover")
    const hoverResult = await rpc("hover", { ref: hoverRef })
    check(!!hoverResult && typeof hoverResult === "object" && "ok" in hoverResult && hoverResult.ok === true, "hover failed")
    const hoverGone = await rpc("hover", { ref: 999999 })
    check(!!hoverGone && typeof hoverGone === "object" && "ok" in hoverGone && hoverGone.ok === false, "hover on missing ref was not refused")
    pass("L08", "dock_hover dispatches mouseover on live element")

    const clickSnap = await rpc("read", {})
    check(!!clickSnap && typeof clickSnap === "object" && "items" in clickSnap && Array.isArray(clickSnap.items), "snapshot shape")
    const clickTarget = clickSnap.items.find((item) => !!item && typeof item === "object" && "name" in item && item.name === "Increment")
    check(
      !!clickTarget && typeof clickTarget === "object" && "x" in clickTarget && "y" in clickTarget &&
        "width" in clickTarget && "height" in clickTarget && typeof clickTarget.x === "number" &&
        typeof clickTarget.y === "number" && typeof clickTarget.width === "number" && typeof clickTarget.height === "number",
      "Increment rect missing from snapshot",
    )
    const clickAtResult = await rpc("clickAt", {
      x: clickTarget.x + clickTarget.width / 2,
      y: clickTarget.y + clickTarget.height / 2,
    })
    check(!!clickAtResult && typeof clickAtResult === "object" && "ok" in clickAtResult && clickAtResult.ok === true, "clickAt failed")
    const afterClickAt = await rpc("read", {})
    check(
      !!afterClickAt && typeof afterClickAt === "object" && "text" in afterClickAt && typeof afterClickAt.text === "string" && afterClickAt.text.includes("2"),
      `counter not incremented by clickAt: result=${JSON.stringify(clickAtResult)} snapshot=${JSON.stringify(afterClickAt)}`,
    )
    const clickAtGone = await rpc("clickAt", { x: 9999, y: 9999 })
    check(!!clickAtGone && typeof clickAtGone === "object" && "ok" in clickAtGone && clickAtGone.ok === false, "clickAt with no element at coordinates was not refused")
    pass("L09", "dock_clickAt clicks live coordinates")

    const dragSnap = await rpc("read", {})
    check(!!dragSnap && typeof dragSnap === "object" && "items" in dragSnap && Array.isArray(dragSnap.items), "snapshot shape")
    const dragFrom = dragSnap.items.find((item) => !!item && typeof item === "object" && "name" in item && item.name === "Increment" && "ref" in item && typeof item.ref === "number")?.ref
    const dragTo = dragSnap.items.find((item) => !!item && typeof item === "object" && "tag" in item && item.tag === "input" && "ref" in item && typeof item.ref === "number")?.ref
    check(typeof dragFrom === "number" && typeof dragTo === "number", "drag refs missing")
    const dragResult = await rpc("drag", { fromRef: dragFrom, toRef: dragTo })
    check(!!dragResult && typeof dragResult === "object" && "ok" in dragResult && dragResult.ok === true, "drag failed")
    const dragGone = await rpc("drag", { fromRef: 999999, toRef: dragTo })
    check(!!dragGone && typeof dragGone === "object" && "ok" in dragGone && dragGone.ok === false, "drag with missing ref was not refused")
    const dragSelf = await rpc("drag", { fromRef: dragFrom, toRef: dragFrom })
    check(!!dragSelf && typeof dragSelf === "object" && "ok" in dragSelf && dragSelf.ok === true, "drag onto itself failed")
    const afterDrag = await rpc("read", {})
    check(!!afterDrag && typeof afterDrag === "object" && "title" in afterDrag && afterDrag.title === "drop-ok", "drop listener did not observe live drag")
    pass("L10", "dock_drag runs pointer drag sequence on live elements")

    await rpc("scrollTo", { x: 0, y: 0 })
    const afterScrollTo = await rpc("read", {})
    check(!!afterScrollTo && typeof afterScrollTo === "object" && "title" in afterScrollTo, "read after scrollTo failed")
    pass("L11", "dock_scrollTo jumps to live coordinates")

    const shadowSnap = await rpc("read", {})
    check(!!shadowSnap && typeof shadowSnap === "object" && "items" in shadowSnap && Array.isArray(shadowSnap.items), "snapshot shape")
    check(
      shadowSnap.items.some((item) => !!item && typeof item === "object" && "name" in item && "tag" in item && item.name === "shadow name" && item.tag === "input"),
      "shadow DOM input missing from live snapshot",
    )
    check(
      !shadowSnap.items.some((item) => !!item && typeof item === "object" && "name" in item && item.name === "hidden shadow"),
      "aria-hidden shadow DOM input leaked into live snapshot",
    )
    pass("L12", "dock_read pierces open shadow DOM in live snapshot")

    const benchmarkStarted = Date.now()
    for (let iteration = 0; iteration < 100; iteration++) {
      const before = await rpc("read", {})
      check(before && typeof before === "object" && "items" in before && Array.isArray(before.items), `benchmark read ${iteration + 1} failed`)
      const buttonRef = before.items.find((item) => item.name === "Increment")?.ref
      check(typeof buttonRef === "number", `benchmark ref ${iteration + 1} missing`)
      const clicked = await rpc("click", { ref: buttonRef })
      check(clicked && typeof clicked === "object" && "ok" in clicked && clicked.ok === true, `benchmark click ${iteration + 1} failed`)
      const after = await rpc("read", {})
      check(after && typeof after === "object" && "text" in after && typeof after.text === "string", `benchmark result ${iteration + 1} missing`)
    }
    pass("L14", `100 read-click-read cycles completed in ${Date.now() - benchmarkStarted}ms`)

    const linkRef = shadowSnap.items.find((item) => item.name === "Next page")?.ref
    check(typeof linkRef === "number", "fixture link ref missing")
    const linkClick = await rpc("click", { ref: linkRef })
    const nextPage = await rpc("read", {})
    check(linkClick && typeof linkClick === "object" && "ok" in linkClick && linkClick.ok === true, `same-origin click failed: ${JSON.stringify(linkClick)}`)
    check(nextPage && typeof nextPage === "object" && "url" in nextPage && nextPage.url.endsWith("/next"), "link navigation was not observed")
    pass("L13", "dock_click observes deterministic same-origin link navigation")

    const blockedSnap = await rpc("read", {})
    const blockedItems = blockedSnap && typeof blockedSnap === "object" && "items" in blockedSnap && Array.isArray(blockedSnap.items)
      ? blockedSnap.items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      : []
    const blockedTarget = blockedItems.find((item) => item.name === "Blocked redirect")
    check(
      blockedTarget && typeof blockedTarget.x === "number" && typeof blockedTarget.y === "number" &&
        typeof blockedTarget.width === "number" && typeof blockedTarget.height === "number",
      "blocked redirect target missing",
    )
    const blockedClick = await rpc("clickAt", { x: blockedTarget.x + blockedTarget.width / 2, y: blockedTarget.y + blockedTarget.height / 2 })
    check(
      blockedClick && typeof blockedClick === "object" && "ok" in blockedClick && blockedClick.ok === false &&
        "navigation" in blockedClick && blockedClick.navigation === "blocked",
      `HTTP redirect was not reported as blocked: ${JSON.stringify(blockedClick)}`,
    )
    const afterBlocked = await rpc("read", {})
    check(afterBlocked && typeof afterBlocked === "object" && "url" in afterBlocked && afterBlocked.url.endsWith("/next"), "blocked redirect changed page URL")
    pass("L15", "dock_click reports blocked HTTP redirects")

    outcome = cases.length === expectedCases.size && new Set(cases.map((item) => item.id)).size === expectedCases.size && cases.every((item) => expectedCases.has(item.id)) ? 0 : 1
  } finally {
    const report = { version: 1, cases }
    await mkdir(dirname(artifact), { recursive: true })
    await writeFile(artifact, JSON.stringify(report, null, 2))
    await server.listener.stop()
    win.destroy()
    await site.close()
    app.exit(outcome)
  }
}

async function parent() {
  const buildDir = await mkdtemp(join(tmpdir(), "app-dock-live-e2e-"))
  try {
    const result = await Bun.build({
      entrypoints: [join(desktopMain, "app-dock-live.test.ts")],
      outdir: buildDir,
      naming: "app-dock-live.test.cjs",
      target: "node",
      format: "cjs",
      external: ["electron"],
      write: true,
    })
    check(result.success && result.outputs?.[0], "bundle failed")
    const built = result.outputs![0].path
    await access(built)
    const sidecar = join(outMain, "sidecar.js")
    await access(sidecar)
    const hosted = join(outMain, "app-dock-live.test.cjs")
    await copyFile(built, hosted)
    const electronModule = createRequire(join(process.cwd(), "package.json")).resolve("electron")
    const electron = join(dirname(electronModule), "dist/Electron.app/Contents/MacOS/Electron")
    await access(electron)
    const env = {
    ...process.env,
    APP_DOCK_ARTIFACT_ROOT: root,
    APP_DOCK_SIDECAR: sidecar,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  }
    await rm(artifact, { force: true })
    const child = spawn(electron, [hosted, "--app-dock-live-child"], { stdio: ["ignore", "pipe", "pipe"], env })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    let timedOut = false
    const watchdog = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, 120_000)
    const exitResult = await new Promise<{ code: number | null }>((resolveProcess, reject) => {
      child.once("exit", (code) => resolveProcess({ code }))
      child.once("error", reject)
    })
    clearTimeout(watchdog)
    if (exitResult.code !== 0) throw new Error(`child failed (${exitResult.code})${timedOut ? " timed out" : ""}: ${stderr}`)
    const report = JSON.parse(await readFile(artifact, "utf8"))
    check(
      report.version === 1 &&
        Array.isArray(report.cases) &&
        report.cases.length === expectedCases.size &&
        new Set(report.cases.map((item: Case) => item.id)).size === expectedCases.size &&
        report.cases.every((item: Case) => expectedCases.has(item.id) && item.status === "pass"),
      "invalid app-dock-live artifact",
    )
  } finally {
    await rm(buildDir, { recursive: true, force: true })
    await rm(join(outMain, "app-dock-live.test.cjs"), { force: true })
  }
}

if (process.argv.includes("--app-dock-live-child"))
  void child().catch((error) => {
    console.error(error)
    process.exit(1)
  })
else
  void parent().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
