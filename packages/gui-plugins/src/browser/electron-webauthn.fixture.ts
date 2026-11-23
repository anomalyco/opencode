import { createServer } from "node:http"
import electron from "electron"
import { createCdp } from "./cdp"
import { guardWebAuthn } from "./webauthn-gate"

// The Electron main process of `electron-webauthn.test.ts`, bundled and run by the pinned Electron. It prints one JSON
// line. Pages on localhost, a valid relying party, ask for passkeys in tabs whose refusal is enforced in the browser
// process (CDP's virtual authenticator environment, with no authenticator unless a step adds one), so no request can
// reach the system's WebAuthn API and no system dialog can open.
//
// Every request runs only after a harmless check proved the environment covers the page: where this machine has a
// platform authenticator, Chromium reports one in a page without the environment and none in a page with it, and a
// virtual authenticator receives the credential a request creates. If a check fails, the run stops before any further
// request and says why.

electron.app.commandLine.appendSwitch("host-resolver-rules", "MAP localhost 127.0.0.1")

/** What a page answers `executeJavaScript` with here: JSON values. */
type Json = string | number | boolean | null | undefined | Json[] | { [key: string]: Json }

// `?frame=<url>` embeds that address, which on another site runs in a renderer process of its own.
const server = createServer((request, response) => {
  const frame = new URL(request.url ?? "/", "http://localhost").searchParams.get("frame")
  response.writeHead(200, { "content-type": "text/html" })
  response.end(`<!doctype html><title>passkeys</title>${frame ? `<iframe src="${encodeURI(frame)}"></iframe>` : ""}`)
})

const get = (extra = "") =>
  `{ challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: "localhost", timeout: 1000, userVerification: "discouraged"${extra} }`

const create = `{ challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { id: "localhost", name: "Test" }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "a", displayName: "A" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { residentKey: "required", userVerification: "discouraged" }, timeout: 1000 }`

const authenticator = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } as const

const outcome = (call: string) => `Promise.resolve().then(() => ${call}).then((value) => value === null ? "null" : "credential", (error) => error.name)`

const uvpaa = "PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()"

void electron.app.whenReady().then(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://localhost:${address instanceof Object ? address.port : 0}`
  const win = new electron.BrowserWindow({ show: false })
  const result: { [key: string]: Json } = {}

  const print = (stopped?: string) => {
    process.stdout.write(`${JSON.stringify({ ...result, stopped })}\n`)
    server.close()
    electron.app.quit()
  }

  // A tab as the pane makes one: the environment, if any, is turned on before the first document loads.
  const tab = async (name: string, input: { native: boolean; wrapper: boolean; enforce: boolean; path?: string }) => {
    const view = new electron.WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: `webauthn-${name}` } })
    win.contentView.addChildView(view)
    const contents = view.webContents
    const cdp = createCdp(contents)
    const refusals = { count: 0 }
    const gate = guardWebAuthn(cdp, { native: input.native, refused: () => refusals.count++ })

    // As the pane does: everything is sent before the first document, which the renderer answers once it exists.
    const ready = Promise.all([
      input.enforce ? gate.enforce() : undefined,
      cdp.send("Runtime.enable"),
      cdp.send("Page.enable"),
      input.wrapper ? gate.attach() : undefined,
    ])

    await contents.loadURL(`${origin}${input.path ?? "/"}`)
    await ready
    const run = (code: string): Promise<Json> => contents.executeJavaScript(code)

    return { contents, cdp, gate, refusals, run }
  }

  // Whether the page answers from the environment: it reports no platform authenticator, then the virtual one a step
  // adds, then none again. A page outside it reports the system's answer each time.
  const covered = async (item: Awaited<ReturnType<typeof tab>>) => {
    const before = await item.run(uvpaa)
    const { authenticatorId } = await item.cdp.send("WebAuthn.addVirtualAuthenticator", { options: authenticator })
    const during = await item.run(uvpaa)
    await item.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId })
    const after = await item.run(uvpaa)

    return before === false && during === true && after === false
  }

  const plain = await tab("plain", { native: true, wrapper: false, enforce: false })
  result.plainUVPAA = await plain.run(uvpaa)

  // 1. The browser process alone: no wrapper, only the environment.
  const bare = await tab("bare", { native: true, wrapper: false, enforce: true })
  result.bareCovered = await covered(bare)

  if (!result.bareCovered) return print("the environment does not cover the page")
  const { authenticatorId } = await bare.cdp.send("WebAuthn.addVirtualAuthenticator", { options: authenticator })
  result.routedCreate = await bare.run(outcome(`navigator.credentials.create({ publicKey: ${create} })`))
  result.routedCredentials = (await bare.cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length

  if (result.routedCredentials !== 1) return print("a request did not reach the virtual environment")
  await bare.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId })
  // With no authenticator, a request that got around every page-side check ends at its own timeout.
  result.bareGet = await bare.run(outcome(`navigator.credentials.get({ publicKey: ${get()} })`))

  // 2. A Windows tab the agent drives: the wrapper asks the pane, which refuses, over the environment.
  const agent = await tab("agent", { native: true, wrapper: true, enforce: true })
  result.agentCovered = await covered(agent)

  if (!result.agentCovered) return print("the environment does not cover the agent's tab")
  // A function object as the options, which the first wrapper sent on unchecked.
  result.functionOptions = await agent.run(outcome(`navigator.credentials.get(Object.assign(() => {}, { publicKey: ${get()} }))`))
  // A `publicKey` getter that answers the wrapper's read with nothing and a later read with the request.
  result.twoFacedGetter = await agent.run(
    outcome(`(() => { let reads = 0; const publicKey = ${get()}; return navigator.credentials.get({ get publicKey() { return reads++ ? publicKey : undefined } }) })()`),
  )
  // Inherited options, which a copy of own properties would miss.
  result.inheritedOptions = await agent.run(outcome(`navigator.credentials.get(Object.create({ publicKey: ${get()} }))`))
  // Nothing of the gate is on the page: no globals beyond what a page without it has, and native-looking functions.
  const names = (run: (code: string) => Promise<Json>) => run("Object.getOwnPropertyNames(globalThis)")
  const [withGate, without] = await Promise.all([names(agent.run), names(plain.run)])
  result.addedGlobals = Array.isArray(withGate) && Array.isArray(without) ? withGate.filter((name) => !without.includes(name)) : "unreadable"
  result.nativeLooking = await agent.run(
    `[navigator.credentials.get, navigator.credentials.create, PublicKeyCredential.isConditionalMediationAvailable].map((fn) => Function.prototype.toString.call(fn).includes("[native code]"))`,
  )

  // A new frame's realm, read before any script of the page's could have wrapped it.
  result.frameRealm = await agent.run(
    outcome(`(() => { const frame = document.createElement("iframe"); document.body.append(frame); return frame.contentWindow.navigator.credentials.get({ publicKey: ${get()} }) })()`),
  )
  result.agentRefusals = agent.refusals.count
  // 3. A pop-up the agent's tab opens and scripts at once: enforced while Electron creates it.
  agent.contents.setWindowOpenHandler(() => ({
    action: "allow",
    createWindow: (options) => {
      const view = new electron.WebContentsView({ ...options })
      win.contentView.addChildView(view)
      void guardWebAuthn(createCdp(view.webContents), { native: true, refused: () => undefined }).enforce()

      return view.webContents
    },
  }))
  result.popupUVPAA = await agent.run(`window.open("about:blank", "_blank", "popup").PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`)

  // 4. macOS and Linux: the wrapper refuses on its own, over the environment.
  const mac = await tab("mac", { native: false, wrapper: true, enforce: true })

  result.capabilities = await mac.run(`Promise.all([
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
    PublicKeyCredential.isConditionalMediationAvailable(),
    PublicKeyCredential.getClientCapabilities?.(),
  ])`)

  // The request's own timeout is far past the test's, so only a refusal that comes at once lets the test finish.
  result.macGet = await mac.run(outcome(`navigator.credentials.get({ publicKey: { ...${get()}, timeout: 600000 } })`))
  result.macCreate = await mac.run(outcome(`navigator.credentials.create({ publicKey: { ...${create}, timeout: 600000 } })`))
  result.afterExplicit = mac.refusals.count

  // Autofill waits, without a refusal, for a passkey the person never picks; a refused request that came after it
  // returns first, and only the page's abort ends it.
  result.conditional = await mac.run(`(async () => {
    const controller = new AbortController()
    let settled = "pending"
    navigator.credentials.get({ publicKey: ${get()}, mediation: "conditional", signal: controller.signal }).then(() => (settled = "resolved"), (error) => (settled = error.name))
    await navigator.credentials.get({ publicKey: ${get()} }).catch(() => undefined)
    const before = settled
    controller.abort()
    await Promise.resolve()
    return { before, after: settled }
  })()`)

  result.immediate = await mac.run(outcome(`navigator.credentials.get({ publicKey: ${get()}, mediation: "immediate" })`))
  result.preAborted = await mac.run(outcome(`navigator.credentials.get({ publicKey: ${get()}, signal: AbortSignal.abort() })`))
  result.afterConditional = mac.refusals.count

  // A password manager that wraps the API after the gate, as extensions do, answers its own passkeys; what it hands
  // back goes to the gate.
  result.manager = await mac.run(`(() => {
    const previous = navigator.credentials.get.bind(navigator.credentials)
    navigator.credentials.get = (request) => request && request.publicKey && window.vault ? Promise.resolve("from-manager") : previous(request)
    window.vault = true
    return navigator.credentials.get({ publicKey: ${get()} }).then((value) => {
      window.vault = false
      return navigator.credentials.get({ publicKey: ${get()} }).then(() => [value, "resolved"], (error) => [value, error.name])
    })
  })()`)

  result.refusals = mac.refusals.count

  // 5. Out-of-process frames: the environment covers another site's frame, after the page goes to another site, and
  // after its renderer crashed and the page loaded again. Only the platform-authenticator check runs here.
  const other = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
  const frames = await tab("frames", { native: true, wrapper: false, enforce: true, path: `/?frame=${other}/` })

  const frameCovered = async () => {
    const frame = frames.contents.mainFrame.frames[0]

    if (!frame) return "no frame"
    const separate = frame.osProcessId !== frames.contents.mainFrame.osProcessId
    // A frame answers `unknown`; this one answers a boolean, or the check failed.
    const ask = () => frame.executeJavaScript(uvpaa).then((value): Json => (value === true || value === false ? value : "unreadable"))
    const before = await ask()
    const { authenticatorId } = await frames.cdp.send("WebAuthn.addVirtualAuthenticator", { options: authenticator })
    const during = await ask()
    await frames.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId })
    const after = await ask()

    return [separate, before, during, after]
  }

  const loaded = () => new Promise<void>((resolve) => frames.contents.once("did-finish-load", () => resolve()))
  const gone = () => new Promise<void>((resolve) => frames.contents.once("render-process-gone", () => resolve()))

  result.frameOutOfProcess = await frameCovered()
  await frames.contents.loadURL(`${other}/?frame=${origin}/`)
  result.frameAfterNavigation = await frameCovered()
  const crashed = gone()
  frames.contents.forcefullyCrashRenderer()
  await crashed
  const reloaded = loaded()
  frames.contents.reload()
  await reloaded
  result.frameAfterCrash = await frameCovered()
  result.pageAfterCrash = await frames.run(uvpaa)
  ;[plain, bare, agent, mac, frames].forEach((item) => item.gate.dispose())
  print()
}).catch((error: Error) => {
  process.stdout.write(`${JSON.stringify({ stopped: String(error) })}\n`)
  electron.app.quit()
})
