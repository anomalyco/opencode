import { createServer } from "node:http"
import electron from "electron"
import { createCdp } from "./cdp"
import { guardWebAuthn } from "./webauthn-gate"

// The Electron main process of `electron-webauthn.test.ts`, bundled and run by the pinned Electron. A page on
// localhost, a valid relying party, asks for passkeys through the WebAuthn gate, which refuses every explicit request
// in the page that asks: no request reaches Chromium's WebAuthn stack, so the system shows nothing. A second page only
// reads what the gate reports where the system answers requests itself, and asks for nothing. It prints one JSON line.

electron.app.commandLine.appendSwitch("host-resolver-rules", "MAP localhost 127.0.0.1")

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" })
  response.end("<!doctype html><title>passkeys</title>")
})

const options = `{ challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: "localhost", timeout: 20000, allowCredentials: [{ type: "public-key", id: crypto.getRandomValues(new Uint8Array(64)), transports: ["usb", "internal"] }] }`

const create = `{ challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { id: "localhost", name: "Test" }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "a", displayName: "A" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }], timeout: 20000 }`

void electron.app.whenReady().then(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://localhost:${address instanceof Object ? address.port : 0}`
  const win = new electron.BrowserWindow({ show: false })

  const page = async (native: boolean, refused: () => void) => {
    const view = new electron.WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: `webauthn-${native}` } })
    win.contentView.addChildView(view)
    const contents = view.webContents
    await contents.loadURL("about:blank")
    const cdp = createCdp(contents)
    const gate = guardWebAuthn(cdp, { native, allow: () => false, refused })
    await cdp.send("Runtime.enable")
    await cdp.send("Page.enable")
    await gate.attach()
    await contents.loadURL(`${origin}/`)

    return { contents, gate }
  }

  const refusals = { count: 0 }
  const refusing = await page(false, () => refusals.count++)
  const run = (code: string) => refusing.contents.executeJavaScript(code)

  const capabilities = await run(`Promise.all([
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
    PublicKeyCredential.isConditionalMediationAvailable(),
    PublicKeyCredential.getClientCapabilities?.(),
  ])`)

  const timed = (call: string) =>
    run(`(() => { const start = performance.now(); return ${call}.then(() => ({ name: "resolved" }), (error) => ({ name: error.name, message: error.message, ms: performance.now() - start })) })()`)

  const get = await timed(`navigator.credentials.get({ publicKey: ${options} })`)
  const made = await timed(`navigator.credentials.create({ publicKey: ${create} })`)
  const afterExplicit = refusals.count

  // Autofill waits for a passkey the person never picks, without a refusal, until the page stops it.
  const conditional = await run(`new Promise((resolve) => {
    const controller = new AbortController()
    let settled = "pending"
    navigator.credentials.get({ publicKey: ${options}, mediation: "conditional", signal: controller.signal }).then(() => (settled = "resolved"), (error) => (settled = error.name))
    setTimeout(() => { const before = settled; controller.abort(); setTimeout(() => resolve({ before, after: settled }), 50) }, 500)
  })`)

  const immediate = await run(`navigator.credentials.get({ publicKey: ${options}, mediation: "immediate" }).then(() => "resolved", (error) => error.name)`)
  const preAborted = await run(`navigator.credentials.get({ publicKey: ${options}, signal: AbortSignal.abort() }).then(() => "resolved", (error) => error.name)`)
  const afterConditional = refusals.count

  // A password manager that wraps the API after the gate, as extensions do, answers its own passkeys; what it hands
  // back goes to the gate.
  const manager = await run(`(() => {
    const previous = navigator.credentials.get.bind(navigator.credentials)
    navigator.credentials.get = (request) => request && request.publicKey && request.publicKey.rpId === "localhost" && window.vault ? Promise.resolve("from-manager") : previous(request)
    window.vault = true
    return navigator.credentials.get({ publicKey: ${options} }).then((value) => {
      window.vault = false
      return navigator.credentials.get({ publicKey: ${options} }).then(() => [value, "resolved"], (error) => [value, error.name])
    })
  })()`)

  const native = await page(true, () => undefined)

  const nativeCapabilities = await native.contents.executeJavaScript(`Promise.all([
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
    PublicKeyCredential.isConditionalMediationAvailable(),
    PublicKeyCredential.getClientCapabilities?.(),
  ])`)

  process.stdout.write(
    `${JSON.stringify({ capabilities, get, made, afterExplicit, conditional, immediate, preAborted, afterConditional, manager, refusals: refusals.count, nativeCapabilities })}\n`,
  )
  refusing.gate.dispose()
  native.gate.dispose()
  server.close()
  electron.app.quit()
})
