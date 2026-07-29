import { Browser } from "@opencode-ai/schema/browser"
import {
  BrowserDriverError,
  type BrowserDriver,
  type BrowserDriverContext,
  type BrowserDriverInstance,
} from "./driver.js"

type ChromiumViewState = Omit<Browser.State, "generation">
type ChromiumViewEvent = { readonly state: ChromiumViewState; readonly mainDocumentChanged: boolean }
type ChromiumCommands = {
  "Runtime.evaluate": { readonly expression: string }
  "Runtime.callFunctionOn": {
    readonly objectId: string
    readonly functionDeclaration: string
    readonly arguments?: ReadonlyArray<{ readonly value: string }>
    readonly returnByValue: true
  }
  "Runtime.releaseObject": { readonly objectId: string }
  "Input.dispatchMouseEvent": {
    readonly type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel"
    readonly x: number
    readonly y: number
    readonly button?: "left"
    readonly clickCount?: 1
    readonly deltaX?: number
    readonly deltaY?: number
  }
  "Input.dispatchKeyEvent": {
    readonly type: "keyDown" | "keyUp"
    readonly key: string
    readonly code: string
    readonly modifiers?: number
    readonly windowsVirtualKeyCode?: number
  }
  "Input.insertText": { readonly text: string }
}
type ChromiumCommand = {
  [Method in keyof ChromiumCommands]: { readonly method: Method; readonly params: ChromiumCommands[Method] }
}[keyof ChromiumCommands]

/** Platform primitives used by the shared semantic driver. */
export interface ChromiumPort<Resource> {
  readonly resource: Resource; readonly state: () => ChromiumViewState
  readonly subscribe: (listener: (event: ChromiumViewEvent) => void) => () => void
  readonly navigate: (url: string) => PromiseLike<void>; readonly back: () => PromiseLike<void> | void
  readonly forward: () => PromiseLike<void> | void; readonly reload: () => PromiseLike<void> | void
  readonly stop: () => void; readonly send: (command: ChromiumCommand) => PromiseLike<unknown>
  readonly viewport: () => { readonly width: number; readonly height: number }
  readonly screenshot: (maxDimension: number) => PromiseLike<{
    readonly data: Uint8Array
    readonly width: number
    readonly height: number
  }>
  readonly dispose: () => PromiseLike<void> | void
}

export interface ChromiumController<Resource> extends AsyncDisposable {
  readonly resource: Resource; readonly state: () => Browser.State
  readonly subscribe: (listener: (state: Browser.State) => void) => () => void
  readonly navigate: (url: string) => Promise<void>; readonly back: () => Promise<void>
  readonly forward: () => Promise<void>; readonly reload: () => Promise<void>
  readonly stop: () => void; readonly dispose: () => Promise<void>
}

export type ChromiumDriver<Resource> = BrowserDriver<ChromiumController<Resource>>

type SnapshotNode = {
  readonly token?: string; readonly role: string; readonly name: string; readonly value: string; readonly depth: number
  readonly checked?: boolean; readonly disabled?: boolean; readonly expanded?: boolean; readonly selected?: boolean
}

type Page<Resource> = {
  readonly port: ChromiumPort<Resource>; readonly lifetime: AbortSignal
  readonly refs: Set<string>; readonly listeners: Set<(state: Browser.State) => void>
  state: ChromiumViewState; document: number; nextRef: number; snapshotObjectID?: string
  active?: AbortController; unsubscribe?: () => void; queue: Promise<void>
  disposed: boolean; disposal?: Promise<void>
}

const commandTimeout = 10_000
const snapshotLimit = 500
const screenshotDimensionLimit = 2_000
const screenshotByteLimit = 5 * 1_024 * 1_024
export function chromiumDriver<Resource>(
  create: (context: BrowserDriverContext) => PromiseLike<ChromiumPort<Resource>> | ChromiumPort<Resource>,
): ChromiumDriver<Resource> {
  return async (context) => {
    const port = await create(context)
    if (!context.signal.aborted) return createInstance(port, context.signal)
    await Promise.resolve(port.dispose())
    throw context.signal.reason instanceof Error ? context.signal.reason : new Error("Chromium driver creation was aborted")
  }
}
function createInstance<Resource>(
  port: ChromiumPort<Resource>,
  lifetime: AbortSignal,
): BrowserDriverInstance<ChromiumController<Resource>> {
  const page: Page<Resource> = {
    port,
    lifetime,
    refs: new Set(),
    listeners: new Set(),
    state: port.state(),
    document: 0,
    nextRef: 0,
    queue: Promise.resolve(),
    disposed: false,
  }
  page.unsubscribe = port.subscribe((event) => {
    if (page.disposed) return
    if (event.mainDocumentChanged) {
      page.document++
      invalidateRefs(page)
    }
    page.state = event.state
    publish(page)
  })

  const dispose = () => disposePage(page)
  const controller: ChromiumController<Resource> = Object.freeze({
    resource: port.resource,
    state: () => state(page),
    subscribe: (listener) => subscribe(page, listener),
    navigate: (url) => schedule(page, undefined, (signal) => navigate(page, url, signal)),
    back: () => localAction(page, () => port.back()),
    forward: () => localAction(page, () => port.forward()),
    reload: () => localAction(page, () => port.reload()),
    stop: () => stop(page),
    dispose,
    [Symbol.asyncDispose]: dispose,
  })
  return Object.freeze({
    resource: controller,
    state: controller.state,
    subscribe: controller.subscribe,
    execute: (command: Browser.Command, options: { readonly signal: AbortSignal }) =>
      schedule(page, options.signal, (signal) => execute(page, command, signal)),
    dispose,
  })
}
async function execute<Resource>(page: Page<Resource>, command: Browser.Command, signal: AbortSignal) {
  assertDocument(page, command.generation)
  switch (command.type) {
    case "navigate":
      await navigate(page, command.url, signal)
      return { type: "navigate", state: state(page) } as const
    case "snapshot":
      return snapshot(page, command.generation, signal)
    case "click":
      await click(page, command.ref, command.generation, signal)
      return { type: "click", state: refresh(page) } as const
    case "fill":
      await fill(page, command.ref, command.text, command.generation, signal)
      return { type: "fill", state: refresh(page) } as const
    case "press":
      await press(page, command.key, command.generation, signal)
      return { type: "press", state: refresh(page) } as const
    case "scroll":
      await scroll(page, command.direction, command.pixels, command.generation, signal)
      return { type: "scroll", state: refresh(page) } as const
    case "screenshot":
      return screenshot(page, command.generation, signal)
  }
}
async function navigate<Resource>(page: Page<Resource>, input: string, signal: AbortSignal) {
  const url = normalizeURL(input)
  const onAbort = () => page.port.stop()
  signal.addEventListener("abort", onAbort, { once: true })
  await bounded(() => page.port.navigate(url), signal, 30_000, "The browser navigation timed out.")
    .catch((error) => {
      if (signal.aborted) throw error
      if (error instanceof BrowserDriverError) throw error
      throw browserError("navigation_failed", error instanceof Error ? error.message : String(error))
    })
    .finally(() => signal.removeEventListener("abort", onAbort))
  refresh(page)
}
async function snapshot<Resource>(page: Page<Resource>, generation: number, signal: AbortSignal) {
  const object = await send(
    page,
    { method: "Runtime.evaluate", params: { expression: snapshotExpression(page.nextRef) } },
    signal,
  )
  const objectID = runtimeObjectID(object)
  const result = await send(
    page,
    {
      method: "Runtime.callFunctionOn",
      params: {
        objectId: objectID,
        functionDeclaration: "function() { return this.result }",
        returnByValue: true,
      },
    },
    signal,
  )
    .then(readSnapshot)
    .catch((error) => {
      release(page, objectID)
      throw error
    })
  assertDocument(page, generation)
  invalidateRefs(page)
  page.snapshotObjectID = objectID
  page.nextRef = Math.max(page.nextRef, result.nextRef)
  const lines = result.nodes.map((node) => {
    if (node.token) page.refs.add(node.token)
    const flags = [
      node.checked === undefined ? undefined : `checked=${node.checked}`,
      node.disabled === undefined ? undefined : `disabled=${node.disabled}`,
      node.expanded === undefined ? undefined : `expanded=${node.expanded}`,
      node.selected === undefined ? undefined : `selected=${node.selected}`,
    ].filter((value): value is string => value !== undefined)
    const details = [
      node.name ? JSON.stringify(node.name) : undefined,
      node.value && node.value !== node.name ? `value=${JSON.stringify(node.value)}` : undefined,
    ].filter((value): value is string => value !== undefined)
    return `${"  ".repeat(node.depth)}${node.token ? `${node.token} ` : ""}[${node.role}]${details.length ? ` ${details.join(" ")}` : ""}${flags.length ? ` ${flags.join(" ")}` : ""}`
  })
  const current = page.port.state()
  const content = [
    `Page: ${current.title.replaceAll(/\s+/g, " ").trim().slice(0, 1_024)}`,
    `URL: ${current.url.slice(0, 16_384)}`,
    "",
    ...lines,
  ]
    .join("\n")
    .slice(0, 40 * 1_024)
  return { type: "snapshot", state: refresh(page), format: "opencode.semantic.v1", content } as const
}
async function click<Resource>(page: Page<Resource>, ref: Browser.Ref, generation: number, signal: AbortSignal) {
  const objectID = resolveRef(page, ref)
  const point = await send(
    page,
    {
      method: "Runtime.callFunctionOn",
      params: {
        objectId: objectID,
        functionDeclaration:
          "function(token) { const element = this.refs[token]; if (!element || !element.isConnected) throw new Error('stale element'); element.scrollIntoView({ block: 'center', inline: 'center' }); const bounds = element.getBoundingClientRect(); if (bounds.width <= 0 || bounds.height <= 0) throw new Error('element has no bounds'); return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } }",
        arguments: [{ value: ref }],
        returnByValue: true,
      },
    },
    signal,
  ).then(readPoint)
  assertDocument(page, generation)
  await send(page, { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", ...point } }, signal)
  await inputPair(
    () =>
      send(
        page,
        {
          method: "Input.dispatchMouseEvent",
          params: { type: "mousePressed", button: "left", clickCount: 1, ...point },
        },
        signal,
      ),
    () =>
      send(page, {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseReleased", button: "left", clickCount: 1, ...point },
      }),
  )
  assertDocument(page, generation)
}
async function fill<Resource>(
  page: Page<Resource>,
  ref: Browser.Ref,
  text: string,
  generation: number,
  signal: AbortSignal,
) {
  const editable = await send(
    page,
    {
      method: "Runtime.callFunctionOn",
      params: {
        objectId: resolveRef(page, ref),
        functionDeclaration: fillFunction,
        arguments: [{ value: ref }],
        returnByValue: true,
      },
    },
    signal,
  ).then(runtimeValue)
  assertDocument(page, generation)
  if (editable !== true) throw browserError("stale_ref", "The browser element is not editable. Call browser_snapshot again.")
  const select = { key: "a", code: "KeyA", modifiers: process.platform === "darwin" ? 4 : 2 }
  await keyPair(page, select, signal)
  await keyPair(page, { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, signal)
  await send(page, { method: "Input.insertText", params: { text } }, signal)
  assertDocument(page, generation)
}
async function press<Resource>(page: Page<Resource>, key: Browser.Key, generation: number, signal: AbortSignal) {
  await keyPair(page, keyInfo(key), signal)
  assertDocument(page, generation)
}
async function scroll<Resource>(
  page: Page<Resource>,
  direction: Browser.Direction,
  pixels: number,
  generation: number,
  signal: AbortSignal,
) {
  const viewport = page.port.viewport()
  const distance = Math.min(2_000, Math.max(1, pixels))
  await send(
    page,
    {
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mouseWheel",
        x: Math.max(0, Math.round(viewport.width / 2)),
        y: Math.max(0, Math.round(viewport.height / 2)),
        deltaX: direction === "left" ? -distance : direction === "right" ? distance : 0,
        deltaY: direction === "up" ? -distance : direction === "down" ? distance : 0,
      },
    },
    signal,
  )
  assertDocument(page, generation)
}
async function screenshot<Resource>(page: Page<Resource>, generation: number, signal: AbortSignal) {
  const source = await bounded(
    () => page.port.screenshot(screenshotDimensionLimit),
    signal,
    commandTimeout,
    "The browser screenshot timed out.",
  )
  assertDocument(page, generation)
  if (source.data.byteLength > screenshotByteLimit) {
    throw browserError("result_too_large", "The browser screenshot exceeds 5 MiB.")
  }
  if (
    !Number.isSafeInteger(source.width) ||
    !Number.isSafeInteger(source.height) ||
    source.width < 1 ||
    source.height < 1 ||
    source.width > screenshotDimensionLimit ||
    source.height > screenshotDimensionLimit
  ) {
    throw browserError("internal", "The browser pane has no drawable area.")
  }
  return {
    type: "screenshot",
    state: refresh(page),
    mediaType: "image/png",
    data: new Uint8Array(source.data),
    width: source.width,
    height: source.height,
  } as const
}
function schedule<Resource, Result>(
  page: Page<Resource>,
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<Result>,
) {
  assertAttached(page)
  throwIfAborted(signal)
  const result = page.queue.then(async () => {
    assertAttached(page)
    throwIfAborted(signal)
    const controller = new AbortController()
    page.active = controller
    const combined = AbortSignal.any([page.lifetime, controller.signal, ...(signal ? [signal] : [])])
    return run(combined).finally(() => {
      if (page.active === controller) page.active = undefined
    })
  })
  page.queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result.catch((error) => {
    throw normalizeError(error)
  })
}
function localAction<Resource>(page: Page<Resource>, run: () => PromiseLike<void> | void) {
  return schedule(page, undefined, async (signal) => {
    throwIfAborted(signal)
    await run()
    throwIfAborted(signal)
  })
}
function stop<Resource>(page: Page<Resource>) {
  assertAttached(page)
  page.active?.abort()
  try {
    page.port.stop()
  } catch (error) {
    throw normalizeError(error)
  }
}
function subscribe<Resource>(page: Page<Resource>, listener: (state: Browser.State) => void) {
  assertAttached(page)
  page.listeners.add(listener)
  listener(state(page))
  return () => page.listeners.delete(listener)
}
function publish<Resource>(page: Page<Resource>) {
  const current = state(page)
  page.listeners.forEach((listener) => listener(current))
}
function refresh<Resource>(page: Page<Resource>) {
  page.state = page.port.state()
  publish(page)
  return state(page)
}
function state<Resource>(page: Page<Resource>): Browser.State {
  assertAttached(page)
  return {
    url: page.state.url.slice(0, 16_384),
    title: page.state.title.slice(0, 1_024),
    loading: page.state.loading,
    canGoBack: page.state.canGoBack,
    canGoForward: page.state.canGoForward,
    generation: page.document,
  }
}
function disposePage<Resource>(page: Page<Resource>) {
  if (page.disposal) return page.disposal
  page.disposed = true
  page.active?.abort()
  page.listeners.clear()
  invalidateRefs(page)
  page.unsubscribe?.()
  page.unsubscribe = undefined
  page.port.stop()
  page.disposal = Promise.resolve(page.port.dispose())
  return page.disposal
}
function invalidateRefs<Resource>(page: Page<Resource>) {
  if (page.snapshotObjectID) release(page, page.snapshotObjectID)
  page.snapshotObjectID = undefined
  page.refs.clear()
}
function release<Resource>(page: Page<Resource>, objectID: string) {
  void Promise.resolve(
    page.port.send({ method: "Runtime.releaseObject", params: { objectId: objectID } }),
  ).catch(() => undefined)
}
function resolveRef<Resource>(page: Page<Resource>, ref: Browser.Ref) {
  if (!page.snapshotObjectID || !page.refs.has(ref)) {
    throw browserError("stale_ref", "The element reference is stale. Call browser_snapshot again.")
  }
  return page.snapshotObjectID
}
function send<Resource>(page: Page<Resource>, command: ChromiumCommand, signal?: AbortSignal) {
  return bounded(
    () => page.port.send(command),
    signal,
    commandTimeout,
    "The browser command timed out.",
  ).catch((error) => {
    if (staleProtocolError(error)) {
      throw browserError("stale_ref", "The element reference is stale. Call browser_snapshot again.")
    }
    throw error
  })
}
function readSnapshot(input: unknown) {
  const value = runtimeValue(input)
  if (!record(value) || !Array.isArray(value.nodes) || value.nodes.length > snapshotLimit) {
    throw browserError("internal", "Invalid browser snapshot response.")
  }
  if (!Number.isSafeInteger(value.nextRef) || Number(value.nextRef) < 0) {
    throw browserError("internal", "Invalid browser snapshot response.")
  }
  const nodes = value.nodes.map((node) => {
    if (!snapshotNode(node)) throw browserError("internal", "Invalid browser snapshot response.")
    return node
  })
  return { nodes, nextRef: Number(value.nextRef) }
}
function snapshotNode(input: unknown): input is SnapshotNode {
  if (!record(input)) return false
  if (
    typeof input.role !== "string" ||
    !/^[a-zA-Z0-9_-]{1,40}$/.test(input.role) ||
    typeof input.name !== "string" ||
    typeof input.value !== "string" ||
    !Number.isSafeInteger(input.depth) ||
    Number(input.depth) < 0 ||
    Number(input.depth) > 6
  )
    return false
  if (input.token !== undefined && (typeof input.token !== "string" || !/^e[1-9][0-9]*$/.test(input.token))) return false
  return true
}
function runtimeObjectID(input: unknown) {
  if (!record(input) || !record(input.result) || typeof input.result.objectId !== "string") {
    throw browserError("internal", "Browser page operation failed.")
  }
  return input.result.objectId
}
function runtimeValue(input: unknown) {
  if (!record(input)) throw browserError("internal", "Browser page operation failed.")
  if (input.exceptionDetails !== undefined) {
    const details = record(input.exceptionDetails) ? input.exceptionDetails : undefined
    const exception = details && record(details.exception) ? details.exception : undefined
    const message =
      (exception && typeof exception.description === "string" && exception.description) ||
      (details && typeof details.text === "string" && details.text) ||
      "Browser page operation failed."
    if (staleProtocolError(message)) {
      throw browserError("stale_ref", "The element reference is stale. Call browser_snapshot again.")
    }
    throw browserError("internal", message)
  }
  if (!record(input.result) || !("value" in input.result)) {
    throw browserError("internal", "Browser page operation failed.")
  }
  return input.result.value
}
function readPoint(input: unknown) {
  const value = runtimeValue(input)
  if (!record(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    throw browserError("stale_ref", "The browser element has no clickable bounds.")
  }
  return { x: value.x, y: value.y }
}
function keyPair<Resource>(
  page: Page<Resource>,
  key: { readonly key: string; readonly code: string; readonly modifiers?: number; readonly windowsVirtualKeyCode?: number },
  signal: AbortSignal,
) {
  return inputPair(
    () => send(page, { method: "Input.dispatchKeyEvent", params: { type: "keyDown", ...key } }, signal),
    () => send(page, { method: "Input.dispatchKeyEvent", params: { type: "keyUp", ...key } }),
  )
}
async function inputPair(down: () => Promise<unknown>, up: () => Promise<unknown>) {
  try {
    await down()
  } finally {
    await up()
  }
}
function keyInfo(key: Browser.Key) {
  const codes: Partial<Record<Browser.Key, number>> = {
    Enter: 13,
    Tab: 9,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    Space: 32,
  }
  const windowsVirtualKeyCode = codes[key]
  return {
    key: key === "Space" ? " " : key,
    code: key,
    ...(windowsVirtualKeyCode ? { windowsVirtualKeyCode } : {}),
  }
}
function assertDocument<Resource>(page: Page<Resource>, generation: number) {
  if (page.document !== generation) {
    throw browserError("stale_ref", "The browser page changed. Call browser_snapshot again.")
  }
}
function assertAttached<Resource>(page: Page<Resource>) {
  if (page.disposed) throw browserError("not_attached", "The browser page is no longer attached.")
}
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw browserError("aborted", "The browser action was aborted.")
}
function browserError(code: Browser.ErrorCode, message: string) {
  return new BrowserDriverError(code, message.slice(0, 1_024))
}
function normalizeError(error: unknown) {
  if (error instanceof BrowserDriverError) return error
  return browserError("internal", error instanceof Error ? error.message : String(error))
}
function normalizeURL(input: string) {
  const value = input.trim()
  if (value.length > 16_384) throw browserError("invalid_url", "The browser URL is too long.")
  if (!value || value === "about:blank") return "about:blank"
  const candidate = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(:\d+)?(?:\/|$)/i.test(value)
    ? `http://${value}`
    : /^[a-z][a-z\d+.-]*:/i.test(value)
      ? value
      : `https://${value}`
  if (!URL.canParse(candidate)) throw browserError("invalid_url", "Enter a valid HTTP or HTTPS URL.")
  const url = new URL(candidate)
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw browserError("invalid_url", "Only HTTP, HTTPS, and about:blank URLs are supported.")
  }
  if (url.href.length > 16_384) throw browserError("invalid_url", "The browser URL is too long.")
  return url.href
}
function bounded<Result>(
  run: () => PromiseLike<Result>,
  signal: AbortSignal | undefined,
  timeout: number,
  timeoutMessage: string,
) {
  throwIfAborted(signal)
  const timedOut = AbortSignal.timeout(timeout)
  const abort = signal ? AbortSignal.any([signal, timedOut]) : timedOut
  return new Promise<Result>((resolve, reject) => {
    abort.addEventListener(
      "abort",
      () =>
        reject(
          timedOut.aborted
            ? browserError("timeout", timeoutMessage)
            : browserError("aborted", "The browser action was aborted."),
        ),
      { once: true },
    )
    Promise.resolve().then(run).then(resolve, reject)
  })
}
function staleProtocolError(input: unknown) {
  return /Could not find (node|object)|No node with given id|Node with given id does not belong|Could not push node|Could not compute box model|stale element/i.test(
    input instanceof Error ? input.message : String(input),
  )
}
function snapshotExpression(nextRef: number) {
  return `(() => {
    const interactive = new Set(["button","checkbox","combobox","link","menuitem","option","radio","searchbox","slider","spinbutton","switch","tab","textbox"])
    const readable = new Set(["article","cell","columnheader","heading","img","list","listitem","p","region","row","rowheader","table"])
    const roleFor = (element) => {
      const explicit = element.getAttribute("role")
      if (explicit) return explicit.slice(0, 100).split(/\\s+/)[0]
      if (/^H[1-6]$/.test(element.tagName)) return "heading"
      if (element.tagName === "INPUT") {
        if (element.type === "checkbox") return "checkbox"
        if (element.type === "radio") return "radio"
        if (element.type === "range") return "slider"
        if (element.type === "number") return "spinbutton"
        if (element.type === "search") return "searchbox"
        return "textbox"
      }
      return ({A:"link",ARTICLE:"article",BUTTON:"button",IMG:"img",LI:"listitem",OL:"list",P:"p",SELECT:"combobox",TABLE:"table",TD:"cell",TH:"columnheader",TR:"row",TEXTAREA:"textbox",UL:"list"})[element.tagName] || element.tagName.toLowerCase()
    }
    const clean = (value) => String(value || "").slice(0, 1000).replace(/\\s+/g, " ").trim().slice(0, 300)
    const textFor = (element) => {
      const queue = Array.from(element.childNodes).slice(0, 20)
      const parts = []
      let visited = 0
      while (queue.length && visited++ < 20) {
        const item = queue.shift()
        if (item.nodeType === Node.TEXT_NODE) parts.push(item.nodeValue || "")
        queue.push(...Array.from(item.childNodes).slice(0, Math.max(0, 20 - queue.length - visited)))
      }
      return parts.join(" ")
    }
    const nodes = []
    const refs = Object.create(null)
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT)
    let visited = 0
    let ref = ${Math.max(0, Math.floor(nextRef))}
    while (visited++ < ${snapshotLimit}) {
      const element = walker.nextNode()
      if (!element) break
      if (element.hidden || element.getAttribute("aria-hidden") === "true" || (element.tagName === "INPUT" && element.type === "hidden")) continue
      const role = clean(roleFor(element)).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "node"
      const isInteractive = interactive.has(role) || element.tabIndex >= 0
      if (!isInteractive && !readable.has(role)) continue
      const editable = ["INPUT","TEXTAREA","SELECT"].includes(element.tagName) || ["textbox","searchbox","combobox","spinbutton"].includes(role) || element.isContentEditable
      const labelledBy = element.getAttribute("aria-labelledby")
      const label = labelledBy && document.getElementById(labelledBy)
      const token = isInteractive ? "e" + (++ref) : undefined
      if (token) refs[token] = element
      let depth = 0
      for (let item = element.parentElement; item && depth < 6; item = item.parentElement) depth++
      nodes.push({
        token,
        role,
        name: clean(element.getAttribute("aria-label") || (label && textFor(label)) || element.alt || (editable ? "" : textFor(element))),
        value: editable ? "" : clean(element.value),
        depth,
        checked: "checked" in element ? Boolean(element.checked) : undefined,
        disabled: "disabled" in element ? Boolean(element.disabled) : undefined,
        expanded: element.getAttribute("aria-expanded") === "true" ? true : element.getAttribute("aria-expanded") === "false" ? false : undefined,
        selected: "selected" in element ? Boolean(element.selected) : undefined,
      })
    }
    return { result: { nodes, nextRef: ref }, refs }
  })()`
}
const fillFunction = `function(token) {
  const element = this.refs[token]
  if (!element || !element.isConnected) throw new Error("stale element")
  const role = String(element.getAttribute("role") || "").split(/\\s+/, 1)[0]
  const input = element.tagName === "INPUT" && !["button","checkbox","color","file","hidden","image","radio","range","reset","submit"].includes(String(element.type).toLowerCase())
  const editable = input || element.tagName === "TEXTAREA" || element.isContentEditable || ["textbox","searchbox","combobox","spinbutton"].includes(role)
  if (!editable || element.disabled || element.readOnly || element.getAttribute("aria-disabled") === "true" || element.getAttribute("aria-readonly") === "true") return false
  element.focus()
  return true
}`
function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
