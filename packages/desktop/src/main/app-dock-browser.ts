const registryKey = "__opencodeDockRefs"

const registryExpr = (namespaceExpression = `window[${JSON.stringify(registryKey)}]?.namespace ?? 0`) => `(() => {
  const key = ${JSON.stringify(registryKey)}
  const namespace = ${namespaceExpression}
  if (window[key]) return window[key]
  const refs = new WeakMap()
  const byRef = new Map()
  const registry = {
     refs,
     byRef,
     namespace,
     next: namespace * 4096 + 1,
    refFor(el) {
      const ref = refs.get(el)
      if (ref !== undefined) return ref
       const assigned = registry.next++
      refs.set(el, assigned)
      byRef.set(assigned, el)
      if (byRef.size > 4096) {
        const oldest = byRef.keys().next().value
        byRef.delete(oldest)
      }
      return assigned
    },
    resolve(ref) {
      const el = byRef.get(ref)
      if (!el || !el.isConnected) return null
      return el
    },
  }
   Object.defineProperty(window, key, { value: registry, configurable: true, enumerable: false })
  return registry
})()`

type SnapshotOptions = {
  budget?: number
  maxText?: number
  namespace?: number
}

export function buildSnapshotScript(options: SnapshotOptions = {}) {
  const budget = Math.max(1, Math.min(Math.round(options.budget ?? 100) || 100, 500))
  const maxText = Math.max(0, Math.min(Math.round(options.maxText ?? 1500) || 1500, 20000))
  const namespace = Number.isSafeInteger(options.namespace) && (options.namespace ?? 0) > 0 ? options.namespace : 1
  return `(() => {
  window.__opencodeDockRefNamespace = ${namespace}
  if (window[${JSON.stringify(registryKey)}] && window[${JSON.stringify(registryKey)}].namespace !== ${namespace}) delete window[${JSON.stringify(registryKey)}]
  const registry = ${registryExpr(String(namespace))}
  const budget = ${budget}
  const maxText = ${maxText}
  const state = { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, items: [], text: "", truncated: false }
  const roleOf = (el) => {
    const explicit = el.getAttribute && el.getAttribute("role")
    if (explicit) return explicit
    const tag = el.tagName
    if (tag === "A") return el.hasAttribute("href") ? "link" : "text"
    if (tag === "BUTTON" || tag === "SUMMARY") return "button"
    if (tag === "SELECT") return "listbox"
    if (tag === "TEXTAREA") return "textbox"
    if (tag === "OPTION") return "option"
    if (tag === "INPUT") {
      switch ((el.type || "text").toLowerCase()) {
        case "checkbox": return "checkbox"
        case "radio": return "radio"
        case "range": return "slider"
        case "color": return "button"
        case "file": return "button"
        case "submit": case "reset": case "button": return "button"
        default: return "textbox"
      }
    }
    if (el.isContentEditable) return "textbox"
    if (el.hasAttribute && (el.hasAttribute("onclick") || el.hasAttribute("tabindex") || el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby"))) return "button"
    return null
  }
  const take = (value) => {
    if (!value) return ""
    const s = String(value).replace(/\\s+/g, " ").trim()
    return s.slice(0, 160)
  }
  const nameOf = (el) => {
    if (el.labels && el.labels.length) {
      const fromLabel = take(el.labels[0].innerText)
      if (fromLabel) return fromLabel
    }
    if (el.getAttribute) {
      const labelled = el.getAttribute("aria-labelledby")
      if (labelled) {
        const owner = document.getElementById(labelled.split(/\\s+/)[0])
        if (owner) { const fromOwner = take(owner.innerText); if (fromOwner) return fromOwner }
      }
      const direct = ["aria-label", "alt", "title", "value", "placeholder"].map((key) => take(el.getAttribute(key))).find(Boolean)
      if (direct) return direct
    }
    if (el.innerText) { const fromText = take(el.innerText); if (fromText) return fromText }
    if (el.textContent) { const fromContent = take(el.textContent); if (fromContent) return fromContent }
    return el.tagName ? el.tagName.toLowerCase() : "unknown"
  }
  const visible = (el) => {
    if (!el.getClientRects || el.getClientRects().length === 0) return false
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return false
    return true
  }
  const inert = (el) => {
    let node = el
    while (node && node !== document) {
      if (typeof ShadowRoot !== "undefined" && node instanceof ShadowRoot) { node = node.host; continue }
      if (node.getAttribute && (node.getAttribute("aria-hidden") === "true" || node.getAttribute("hidden") !== null)) return true
      if (node.tagName === "FIELDSET" && node.disabled) return true
      node = node.parentNode
    }
    return false
  }
  const stateOf = (el) => {
    const out = {}
    if (el.disabled !== undefined) out.disabled = el.disabled
    if (el.checked !== undefined) out.checked = el.checked
    if (el.selected !== undefined) out.selected = el.selected
    if (el.getAttribute && el.getAttribute("aria-expanded")) out.expanded = el.getAttribute("aria-expanded") === "true"
    if (el.getAttribute && el.getAttribute("aria-selected")) out.selected = el.getAttribute("aria-selected") === "true"
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") out.value = (el.value || "").slice(0, 200)
    if (el.tagName === "SELECT") out.value = (el.options[el.selectedIndex]?.text || "").slice(0, 160)
    return out
  }
  const selector = "a[href], button, input, textarea, select, option, summary, [contenteditable], [role], [onclick], [tabindex], [aria-label], [aria-labelledby]"
  const elements = []
  const maxShadowDepth = 32
  let traversalTruncated = false
  const collect = (root, depth = 0) => {
    for (const el of root.querySelectorAll(selector)) {
      elements.push(el)
      if (elements.length > budget) return true
    }
    for (const host of root.querySelectorAll("*")) {
      if (!host.shadowRoot) continue
      if (depth >= maxShadowDepth) {
        traversalTruncated = true
        continue
      }
      if (collect(host.shadowRoot, depth + 1)) return true
    }
    return false
  }
  collect(document)
  const accepted = []
  for (const el of elements) {
    if (accepted.length >= budget) break
    if (inert(el) || !visible(el)) continue
    accepted.push(el)
  }
  state.truncated = elements.length > budget || traversalTruncated
  state.items = accepted.map((el) => {
    const target = el.closest && el.closest("a[href]") ? el.closest("a[href]") : el
    const rect = target.getBoundingClientRect()
    const round = (n) => Math.round(n * 10) / 10
      return {
        ref: registry.refFor(el),
        role: roleOf(target),
        name: nameOf(target),
        tag: target.tagName.toLowerCase(),
        href: target.href || undefined,
        x: round(rect.left),
      y: round(rect.top),
      width: round(rect.width),
      height: round(rect.height),
      ...stateOf(el),
    }
  })
  if (maxText > 0 && document.body && document.body.innerText) {
    state.text = document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, maxText)
  }
  return state
})()`
}

export function buildClickScript(ref: number, expectedNamespace?: number) {
  return `(() => {
  const registry = ${registryExpr(expectedNamespace === undefined ? undefined : String(expectedNamespace))}
  if (${expectedNamespace === undefined ? "false" : `registry.namespace !== ${expectedNamespace}`}) return { ok: false, error: "Element ref ${ref} became stale; re-read the page" }
  const el = registry.resolve(${ref})
  if (!el) return { ok: false, error: "Element ref ${ref} is gone; re-read the page" }
  if (!el.isConnected) return { ok: false, error: "Element ref ${ref} is disconnected from DOM" }
  const link = el.closest && el.closest("a[href]")
  const clickTarget = link || el
  const hidden = (node) => { for (let depth = 0; node && depth < 64; depth++) { const style = getComputedStyle(node); if (node.getAttribute?.("aria-hidden") === "true" || node.getAttribute?.("aria-disabled") === "true" || node.hasAttribute?.("hidden") || node.hasAttribute?.("inert") || node.inert === true || (node.tagName === "FIELDSET" && node.disabled === true) || style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0 || style.pointerEvents === "none") return true; const root = node.getRootNode?.(); node = node.parentElement || (root instanceof ShadowRoot ? root.host : null) } return false }
  if (hidden(clickTarget)) return { ok: false, error: "Element ref ${ref} is inert" }
  if (clickTarget.disabled === true) return { ok: false, error: "Element ref ${ref} is disabled" }

  // Check if element is visible and clickable
  const style = getComputedStyle(clickTarget)
  if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0)
    return { ok: false, error: "Element ref ${ref} is not visible" }

  clickTarget.scrollIntoView({ block: "center", inline: "center" })

  const rect = clickTarget.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0)
    return { ok: false, error: "Element ref ${ref} has zero size" }

  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  clickTarget.focus()
  clickTarget.click()

  return { ok: true, tag: clickTarget.tagName.toLowerCase(), ref: ${ref}, x, y, url: location.href, href: clickTarget.href || "" }
})()`
}

export function buildElementPointScript(ref: number, expectedNamespace?: number) {
  return `(async () => {
  const registry = ${registryExpr()}
  if (${expectedNamespace === undefined ? "false" : `registry.namespace !== ${expectedNamespace}`}) return { ok: false, error: "Element ref ${ref} became stale; re-read the page" }
  const el = registry.resolve(${ref})
  if (!el) return { ok: false, error: "Element ref ${ref} is gone; re-read the page" }
  if (!el.isConnected) return { ok: false, error: "Element ref ${ref} is disconnected from DOM" }
  el.scrollIntoView({ block: "center", inline: "center" })
  await new Promise(r => setTimeout(r, 50))
  const link = el.closest && el.closest("a[href]")
  const target = link || el
  const hidden = (node) => { for (let depth = 0; node && depth < 64; depth++) { const style = getComputedStyle(node); if (node.getAttribute?.("aria-hidden") === "true" || node.getAttribute?.("aria-disabled") === "true" || node.hasAttribute?.("hidden") || node.hasAttribute?.("inert") || node.inert === true || (node.tagName === "FIELDSET" && node.disabled === true) || style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0 || style.pointerEvents === "none") return true; const root = node.getRootNode?.(); node = node.parentElement || (root instanceof ShadowRoot ? root.host : null) } return false }
  if (hidden(target)) return { ok: false, error: "Element ref ${ref} is inert" }
  if (target.disabled === true) return { ok: false, error: "Element ref ${ref} is disabled" }
  const targetStyle = getComputedStyle(target)
  if (targetStyle.display === "none" || targetStyle.visibility === "hidden" || parseFloat(targetStyle.opacity) === 0)
    return { ok: false, error: "Element ref ${ref} is not visible" }
  const targetRect = target.getBoundingClientRect()
  if (targetRect.width <= 0 || targetRect.height <= 0) return { ok: false, error: "Element ref ${ref} has zero size" }
  return { ok: true, x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2, tag: target.tagName.toLowerCase(), name: (target.getAttribute("aria-label") || target.textContent || "").trim().slice(0, 200), href: target.href || "" }
})()`
}

export function buildFocusScript(ref: number, expectedNamespace?: number) {
  return `(async () => {
   const registry = ${registryExpr()}
   if (${expectedNamespace === undefined ? "false" : `registry.namespace !== ${expectedNamespace}`}) return { ok: false, error: "Element ref ${ref} became stale; re-read the page" }
  const el = registry.resolve(${ref})
  if (!el) return { ok: false, error: "Element ref ${ref} is gone; re-read the page" }
  if (!el.isConnected) return { ok: false, error: "Element ref ${ref} is disconnected from DOM" }
  el.focus()
  return { ok: true, ref: ${ref}, tag: el.tagName.toLowerCase() }
})()`
}

export function buildReadElementScript(ref: number, expectedNamespace?: number) {
  return `(async () => {
   const registry = ${registryExpr()}
   if (${expectedNamespace === undefined ? "false" : `registry.namespace !== ${expectedNamespace}`}) return { ok: false, error: "Element ref ${ref} became stale; re-read the page" }
  const el = registry.resolve(${ref})
  if (!el) return { ok: false, error: "Element ref ${ref} is gone; re-read the page" }
  const value = el.value !== undefined ? String(el.value) : el.textContent || ""
  return { ok: true, value }
})()`
}

export function buildTypeScript(ref: number, text: string, expectedNamespace?: number) {
  return `(async () => {
   const registry = ${registryExpr()}
   if (${expectedNamespace === undefined ? "false" : `registry.namespace !== ${expectedNamespace}`}) return { ok: false, error: "Element ref ${ref} became stale; re-read the page" }
  const el = registry.resolve(${ref})
  if (!el) return { ok: false, error: "Element ref ${ref} is gone; re-read the page" }
  if (!el.isConnected) return { ok: false, error: "Element ref ${ref} is disconnected from DOM" }
  el.focus()
  const value = ${JSON.stringify(text)}
  if (el.isContentEditable) {
    el.textContent = value
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return { ok: true, ref: ${ref}, method: "contentEditable" }
  }
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value")
    if (!descriptor?.set) return { ok: false, error: "Element ref ${ref} has no writable value" }
    descriptor.set.call(el, value)
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return { ok: true, ref: ${ref}, value: el.value, method: "valueSetter" }
  }
  if (el.tagName === "SELECT") {
    const option = Array.from(el.options).find((candidate) => candidate.value === value || candidate.text === value)
    if (!option) return { ok: false, error: "No matching option for element ref ${ref}" }
    el.value = option.value
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return { ok: true, ref: ${ref}, value: el.value, method: "select" }
  }
  return { ok: false, error: "Element ref ${ref} is not editable (tag: " + el.tagName + ")" }
})()`
}

export function buildScrollScript(direction: "up" | "down" | "top" | "bottom", amount?: number) {
  const pixels = amount ?? (direction === "top" || direction === "bottom" ? 10000 : 300)
  const dir = direction === "up" ? -pixels : direction === "down" ? pixels : direction === "top" ? -10000 : 10000
  return `(() => {
  const before = { x: window.scrollX, y: window.scrollY }
  window.scrollBy(0, ${dir})
  const after = { x: window.scrollX, y: window.scrollY }
  return { ok: true, direction: ${JSON.stringify(direction)}, amount: ${pixels}, before, after }
})()`
}

export function buildHoverScript(ref: number, expectedNamespace?: number) {
  return `(async () => {
   const registry = ${registryExpr()}
   if (${expectedNamespace === undefined ? "false" : `registry.namespace !== ${expectedNamespace}`}) return { ok: false, error: "Element ref ${ref} became stale; re-read the page" }
  const el = registry.resolve(${ref})
  if (!el) return { ok: false, error: "Element ref ${ref} is gone" }
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }))
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }))
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
  return { ok: true }
})()`
}

export function buildDragScript(fromRef: number, toRef: number, expectedNamespace?: number) {
  return `(async () => {
   const registry = ${registryExpr()}
   if (${expectedNamespace === undefined ? "false" : `registry.namespace !== ${expectedNamespace}`}) return { ok: false, error: "Element refs became stale; re-read the page" }
  const from = registry.resolve(${fromRef})
  const to = registry.resolve(${toRef})
  if (!from || !to) return { ok: false, error: "Element ref gone" }
  const rect1 = from.getBoundingClientRect()
  const rect2 = to.getBoundingClientRect()
  from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, clientX: rect1.x, clientY: rect1.y }))
  to.dispatchEvent(new DragEvent("dragover", { bubbles: true, clientX: rect2.x, clientY: rect2.y }))
  to.dispatchEvent(new DragEvent("drop", { bubbles: true, clientX: rect2.x, clientY: rect2.y }))
  from.dispatchEvent(new DragEvent("dragend", { bubbles: true }))
  return { ok: true }
})()`
}

export function buildClickAtScript(x: number, y: number) {
  return `(async () => {
  const selector = "a[href],button,input,select,textarea,summary,[role=button],[onclick],[tabindex]"
  const deepHit = (root) => {
    const candidates = [...root.querySelectorAll(selector)].filter((candidate) => { const rect = candidate.getBoundingClientRect(); return ${x} >= rect.left && ${x} <= rect.right && ${y} >= rect.top && ${y} <= rect.bottom })
    const hit = root === document ? document.elementFromPoint(${x}, ${y}) : (root.elementFromPoint?.(${x}, ${y}) || (candidates.length === 1 ? candidates[0] : null))
    return hit?.shadowRoot ? (deepHit(hit.shadowRoot) || hit) : hit
  }
  const hit = deepHit(document)
   const registry = ${registryExpr()}
  const el = hit && (hit.matches?.(selector) ? hit : hit.closest?.(selector))
  if (!el) return { ok: false, error: "No element at coordinates" }
  if (!(el instanceof HTMLElement)) return { ok: false, error: "No interactive element at coordinates" }
  return { ok: true, ref: registry.refFor(el), tag: el.tagName.toLowerCase(), id: el.id || "", name: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 80), href: el.href || el.closest?.("a[href]")?.href || "" }
})()`
}

export function buildClickAtProbeScript(x: number, y: number, expectedNamespace?: number) {
  return `(async () => {
  const selector = "a[href],button,input,select,textarea,summary,[role=button],[onclick],[tabindex]"
  const deepHit = (root) => {
    const candidates = [...root.querySelectorAll(selector)].filter((candidate) => { const rect = candidate.getBoundingClientRect(); return ${x} >= rect.left && ${x} <= rect.right && ${y} >= rect.top && ${y} <= rect.bottom })
    const hit = root === document ? document.elementFromPoint(${x}, ${y}) : (root.elementFromPoint?.(${x}, ${y}) || (candidates.length === 1 ? candidates[0] : null))
    return hit?.shadowRoot ? (deepHit(hit.shadowRoot) || hit) : hit
  }
  const hit = deepHit(document)
  const registry = ${registryExpr(expectedNamespace === undefined ? undefined : String(expectedNamespace))}
  if (${expectedNamespace === undefined ? "false" : `registry.namespace !== ${expectedNamespace}`}) return { ok: false, error: "Coordinate target became stale; re-read the page" }
  const el = hit && (hit.matches?.(selector) ? hit : hit.closest?.(selector))
  if (!el) return { ok: false, error: "No element at coordinates" }
  if (!(el instanceof HTMLElement)) return { ok: false, error: "No interactive element at coordinates" }
  if (el.disabled === true) return { ok: false, error: "Element at coordinates is disabled" }
  const hidden = (node) => { for (let depth = 0; node && depth < 64; depth++) { const style = getComputedStyle(node); if (node.getAttribute?.("aria-hidden") === "true" || node.getAttribute?.("aria-disabled") === "true" || node.hasAttribute?.("hidden") || node.hasAttribute?.("inert") || node.inert === true || (node.tagName === "FIELDSET" && node.disabled === true) || style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0 || style.pointerEvents === "none") return true; const root = node.getRootNode?.(); node = node.parentElement || (root instanceof ShadowRoot ? root.host : null) } return false }
  if (hidden(el)) return { ok: false, error: "Element at coordinates is inert" }
  const ref = registry.refFor(el)
  const key = "__opencodeDockClickProbe"
  const previous = window[key]
  if (previous?.cleanup) previous.cleanup()
  let fired = false
  const listener = (event) => {
    const target = event.target
     if (target === el || (target instanceof Node && el.contains(target)) || event.composedPath?.().includes(el)) fired = true
  }
  document.addEventListener("click", listener, true)
  window[key] = { fired: () => fired, cleanup: () => document.removeEventListener("click", listener, true) }
  return { ok: true, ref, tag: el.tagName.toLowerCase(), id: el.id || "", name: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 80), href: el.href || el.closest?.("a[href]")?.href || "" }
})()`
}

export function buildScrollToScript(x: number, y: number) {
  return `(() => { window.scrollTo(${x}, ${y}); return { ok: true, x: ${x}, y: ${y} } })()`
}

export function buildWaitScript(milliseconds: number) {
  return `(new Promise((resolve) => setTimeout(() => resolve({ ok: true, waitedMs: ${milliseconds} }), ${milliseconds})))`
}

export function buildKeyboardScript(type: "keyDown" | "keyUp", key: string) {
  return `(async () => {
  const event = new KeyboardEvent(${JSON.stringify(type === "keyDown" ? "keydown" : "keyup")}, {
    key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true,
  })
  const target = document.activeElement || document.body
  target.dispatchEvent(event)
  return {
    ok: true,
    type: ${JSON.stringify(type)},
    key: ${JSON.stringify(key)},
    activeTag: target.tagName.toLowerCase(),
    activeId: target.id || "",
  }
})()`
}
/**
 * Generates a script to set localStorage or sessionStorage.
 * @storage - "local" or "session" storage type
 * @returns Self-invoking async script snippet
 */
export function buildStorageScript(storage: "local" | "session", key: string) {
  const storageName = JSON.stringify(storage)
  const storageKey = JSON.stringify(key)
  return `(async () => {
  const store = ${storageName} === "local" ? window.localStorage : window.sessionStorage
  const value = store.getItem(${storageKey})
  return { ok: true, storage: ${storageName}, key: ${storageKey}, value }
})()`
}

/**
 * Generates a script to capture PDF from canvas.
 * @returns Self-invoking async script snippet
 */
export function buildPDFSript() {
  return '(async () => { const canvas = document.createElement("canvas"); canvas.width = window.innerWidth; canvas.height = window.innerHeight; const ctx = canvas.getContext("2d"); ctx.drawImage(document.body, 0, 0); const pdf = canvas.toBlob(function(blob) { if (blob) { const url = URL.createObjectURL(blob); return { ok: true, blob: blob, url: url } } else { return { ok: false, error: "Failed to create PDF" } } }); return { ok: false, error: "Canvas context failed" } })()'
}

/**
 * Generates a script to change iframe focus.
 * @direction - "next" or "prev" to navigate
 * @returns Self-invoking async script snippet
 */
export function buildFrameScript(direction: "next" | "prev") {
  return '(async () => { const iframes = document.getElementsByTagName("iframe"); const idx = Array.from(iframes).findIndex(f => f.contentWindow === window) || 0; let targetIdx; if (direction === "next") { targetIdx = (idx + 1) % iframes.length } else { targetIdx = (idx - 1 + iframes.length) % iframes.length }; if (iframes[targetIdx]) { iframes[targetIdx].contentWindow.location.href = window.location.href; return { ok: true, iframe: iframes[targetIdx] } } return { ok: false, error: "No more iframes in that direction" } })()'
}

/**
 * Generates a retry script with exponential backoff.
 * @attempts - Maximum retry attempts
 * @delay - Delay in milliseconds between attempts
 * @returns Self-invoking async script snippet
 */
export function buildRetryScript(attempts: number, delay: number) {
  return '(async () => { let attemptsLeft = attempts; while (attemptsLeft > 0) { try { return { ok: true } } catch (e) { attemptsLeft--; if (attemptsLeft > 0) { await new Promise(r => setTimeout(r, delay)) } else { return { ok: false, error: "Max attempts exceeded" } } } } return { ok: false, error: "Retry loop ended" } })()'
}

/**
 * Generates a script to evaluate custom JavaScript.
 * @script - JavaScript string to evaluate
 * @returns Self-invoking async script snippet
 */
export function buildEvaluateScript(script: string) {
  return `(async () => {
  try {
    const result = await window.eval(${JSON.stringify(script)})
    return { ok: true, result: String(result) }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
})()`
}

/**
 * Generates a network request interceptor script.
 * @config - Configuration: blockUrls, allowedOrigins, blockMethods
 * @returns Self-invoking async script snippet
 */
export function buildNetworkScript(config: { blockUrls?: string[]; allowedOrigins?: string[]; blockMethods?: string[] }) {
  return `(async () => {
  const config = ${JSON.stringify(config)}
  const marker = "__opencodeDockNetwork"
  const previous = window[marker]
  if (previous) {
    window.fetch = previous.fetch
    XMLHttpRequest.prototype.open = previous.open
    XMLHttpRequest.prototype.send = previous.send
  }
  const state = previous?.state ?? { blocked: 0, requests: 0 }
  window.__appDockNetwork = state
  const blocked = (url, method) => {
    const parsed = new URL(url, location.href)
    const methodBlocked = !config.blockMethods?.length || config.blockMethods.includes(method.toUpperCase())
    const urlBlocked = config.blockUrls?.some((pattern) => parsed.href.includes(pattern) || parsed.origin === pattern)
    const originAllowed = config.allowedOrigins?.some((origin) => parsed.origin === origin)
    return Boolean(urlBlocked && methodBlocked && !originAllowed)
  }
  const originalFetch = window.fetch
  window.fetch = async function(input, init) {
    const request = new Request(input, init)
    state.requests++
    if (blocked(request.url, request.method)) {
      state.blocked++
      return new Response("Blocked by App Dock", { status: 403 })
    }
    return originalFetch.call(this, request)
  }
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function(method, url) {
    state.requests++
    this.__appDockBlocked = blocked(url, method)
    if (this.__appDockBlocked) state.blocked++
    return originalOpen.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__appDockBlocked) {
      this.abort()
      return
    }
    return originalSend.call(this, body)
  }
  if (config.probeUrl) {
    try { await window.fetch(config.probeUrl, { method: config.probeMethod || "GET" }) } catch (_) {}
  }
  window[marker] = { fetch: originalFetch, open: originalOpen, send: originalSend, state }
  return { ok: true, blocked: state.blocked, requests: state.requests, interceptorReady: true }
})()`
}
