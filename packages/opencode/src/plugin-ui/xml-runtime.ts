/**
 * XML/HTML UI Runtime for OpenCode Plugins
 *
 * Provides Solid-like reactivity with XML/HTML template syntax for plugin UIs.
 * Fully compatible with OpenTUI rendering context and existing plugin system.
 *
 * Usage:
 * ```tsx
 * import { renderXML, signals } from "@opencode/plugin-ui/xml-runtime"
 *
 * const ctx = {
 *   ...signals(['count'], { count: 0 }),
 *   inc() { this.set.count(v => v + 1) }
 * }
 *
 * const template = `
 *   <box flexDirection="column">
 *     <text fg="#00ff00">Count: {count()}</text>
 *     <text on:click="inc">Click to increment</text>
 *   </box>
 * `
 *
 * renderXML(template, mountElement, ctx)
 * ```
 */

// -----------------------------
// 1) Minimal reactive core (Solid-like)
// -----------------------------
export type Accessor<T> = () => T
export type Setter<T> = (v: T | ((prev: T) => T)) => void

let CURRENT_EFFECT: (() => void) | null = null
const DEPS = new WeakMap<object, Set<() => void>>()

export function createSignal<T>(initial: T): [Accessor<T>, Setter<T>] {
  const box = { v: initial } as { v: T }
  return [
    () => {
      if (CURRENT_EFFECT) {
        let s = DEPS.get(box)
        if (!s) DEPS.set(box, (s = new Set()))
        s!.add(CURRENT_EFFECT)
      }
      return box.v
    },
    (next) => {
      const nv = typeof next === "function" ? (next as any)(box.v) : next
      if (Object.is(nv, box.v)) return
      box.v = nv
      const s = DEPS.get(box)
      if (s) for (const eff of [...s]) eff()
    },
  ]
}

export function createEffect(fn: () => void): void {
  const run = () => {
    CURRENT_EFFECT = run
    try {
      fn()
    } finally {
      CURRENT_EFFECT = null
    }
  }
  run()
}

export function onCleanup(fn: () => void) {
  // Store cleanup functions for later disposal
  if (CURRENT_EFFECT) {
    const effect = CURRENT_EFFECT
    if (!(effect as any).__cleanups) {
      ;(effect as any).__cleanups = []
    }
    ;(effect as any).__cleanups.push(fn)
  }
}

// -----------------------------
// 2) Utilities
// -----------------------------
function isEventAttr(name: string) {
  return name.startsWith("on:")
}
function isBindAttr(name: string) {
  return name.startsWith("bind:")
}
function isShowAttr(name: string) {
  return name === "x-show" || name === "x-if"
}
function isForAttr(name: string) {
  return name === "x-for"
}

function toEventName(name: string) {
  // on:click -> click
  return name.slice(3)
}

function evalInScope(expr: string, scope: Record<string, any>) {
  // Scoped evaluator for expressions
  const keys = Object.keys(scope)
  const vals = Object.values(scope)
  // eslint-disable-next-line no-new-func
  return Function(...keys, `with(this){ return (${expr}); }`).call(scope, ...vals)
}

function reactiveApply(apply: () => void) {
  createEffect(apply)
}

// -----------------------------
// 3) OpenTUI Element Creation
// -----------------------------
function createOpenTUIElement(tagName: string, parent: any): any {
  // Check if we're in a proper SolidJS/OpenTUI context
  if (typeof (globalThis as any).__createOpenTUIElement === "function") {
    return (globalThis as any).__createOpenTUIElement(tagName, parent)
  }

  // Fallback: create basic structure compatible with OpenTUI
  const element: any = {
    type: tagName,
    props: {},
    children: [],
    parent,
    _isOpenTUIElement: true,
  }

  return element
}

function appendChild(parent: any, child: any) {
  if (parent.appendChild && typeof parent.appendChild === "function") {
    parent.appendChild(child)
  } else if (Array.isArray(parent.children)) {
    parent.children.push(child)
  } else {
    console.warn("[xml-runtime] Cannot append child - invalid parent", parent)
  }
}

function setElementProp(element: any, name: string, value: any) {
  if (element.setAttribute && typeof element.setAttribute === "function") {
    element.setAttribute(name, value)
  } else if (element.props && typeof element.props === "object") {
    element.props[name] = value
  } else {
    element[name] = value
  }
}

function createTextNode(text: string, parent: any): any {
  if (typeof (globalThis as any).__createOpenTUITextNode === "function") {
    return (globalThis as any).__createOpenTUITextNode(text, parent)
  }

  // Fallback: create text node structure
  return {
    type: "text",
    content: text,
    parent,
    _isOpenTUITextNode: true,
  }
}

// -----------------------------
// 4) XML Parser and Renderer
// -----------------------------
interface ParseNode {
  type: "element" | "text"
  tag?: string
  attrs?: Record<string, string>
  children?: ParseNode[]
  text?: string
}

function parseXML(xml: string): ParseNode[] {
  const nodes: ParseNode[] = []
  const stack: ParseNode[] = []
  let current: ParseNode | null = null

  // Simple XML parser (handles basic cases)
  const tagRegex = /<(\/)?([\w-]+)([^>]*)>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tagRegex.exec(xml)) !== null) {
    // Add text before tag
    if (match.index > lastIndex) {
      const text = xml.substring(lastIndex, match.index)
      if (text.trim()) {
        const textNode: ParseNode = { type: "text", text }
        if (current) {
          if (!current.children) current.children = []
          current.children.push(textNode)
        } else {
          nodes.push(textNode)
        }
      }
    }

    const isClosing = match[1] === "/"
    const tagName = match[2]
    const attrsStr = match[3]

    if (isClosing) {
      // Closing tag
      if (current && current.tag === tagName) {
        const finished = current
        current = stack.pop() || null
        if (current) {
          if (!current.children) current.children = []
          current.children.push(finished)
        } else {
          nodes.push(finished)
        }
      }
    } else {
      // Opening tag
      const node: ParseNode = {
        type: "element",
        tag: tagName,
        attrs: parseAttributes(attrsStr),
        children: [],
      }

      // Check if self-closing
      if (attrsStr.trim().endsWith("/")) {
        if (current) {
          if (!current.children) current.children = []
          current.children.push(node)
        } else {
          nodes.push(node)
        }
      } else {
        if (current) {
          stack.push(current)
        }
        current = node
      }
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < xml.length) {
    const text = xml.substring(lastIndex)
    if (text.trim()) {
      const textNode: ParseNode = { type: "text", text }
      if (current) {
        if (!current.children) current.children = []
        current.children.push(textNode)
      } else {
        nodes.push(textNode)
      }
    }
  }

  // Handle unclosed tags
  while (current) {
    const finished = current
    current = stack.pop() || null
    if (current) {
      if (!current.children) current.children = []
      current.children.push(finished)
    } else {
      nodes.push(finished)
    }
  }

  return nodes
}

function parseAttributes(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRegex = /([\w:-]+)(?:=["']([^"']*)["']|=(\{[^}]*\})|=([^\s>]*))?/g
  let match: RegExpExecArray | null

  while ((match = attrRegex.exec(attrsStr)) !== null) {
    const name = match[1]
    const value = match[2] || match[3] || match[4] || "true"
    attrs[name] = value
  }

  return attrs
}

function processTextNode(text: string, scope: Record<string, any>, parent: any): any[] {
  const parts: any[] = []
  const re = /\{([^}]+)\}/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text))) {
    // Static text before expression
    if (m.index > last) {
      const staticText = text.slice(last, m.index)
      if (staticText) {
        parts.push(createTextNode(staticText, parent))
      }
    }

    // Dynamic expression
    const expr = m[1].trim()
    const textNode = createTextNode("", parent)

    reactiveApply(() => {
      try {
        const value = evalInScope(expr, scope)
        const str = value == null ? "" : String(value)
        if (textNode.content !== undefined) {
          textNode.content = str
        } else if (textNode.nodeValue !== undefined) {
          textNode.nodeValue = str
        } else if (textNode.textContent !== undefined) {
          textNode.textContent = str
        }
      } catch (error) {
        console.error("[xml-runtime] Error evaluating expression:", expr, error)
      }
    })

    parts.push(textNode)
    last = m.index + m[0].length
  }

  // Remaining static text
  if (last < text.length) {
    const staticText = text.slice(last)
    if (staticText) {
      parts.push(createTextNode(staticText, parent))
    }
  }

  return parts.length > 0 ? parts : [createTextNode(text, parent)]
}

function renderNode(node: ParseNode, parent: any, scope: Record<string, any>): any {
  if (node.type === "text") {
    const textParts = processTextNode(node.text || "", scope, parent)
    textParts.forEach((part) => appendChild(parent, part))
    return textParts[0]
  }

  // Element node
  const element = createOpenTUIElement(node.tag || "box", parent)
  const attrs = node.attrs || {}

  // Handle x-if directive
  if (attrs["x-if"]) {
    const condition = attrs["x-if"]
    const anchor = createTextNode("", parent)
    let currentElement: any = null

    reactiveApply(() => {
      try {
        const show = !!evalInScope(condition, scope)

        if (show && !currentElement) {
          // Create element
          currentElement = createOpenTUIElement(node.tag || "box", parent)

          // Apply attributes
          for (const [name, value] of Object.entries(attrs)) {
            if (name === "x-if") continue
            applyAttribute(currentElement, name, value, scope)
          }

          // Render children
          if (node.children) {
            for (const child of node.children) {
              renderNode(child, currentElement, scope)
            }
          }

          // Insert after anchor
          appendChild(parent, currentElement)
        } else if (!show && currentElement) {
          // Remove element
          if (currentElement.remove && typeof currentElement.remove === "function") {
            currentElement.remove()
          }
          currentElement = null
        }
      } catch (error) {
        console.error("[xml-runtime] Error in x-if:", error)
      }
    })

    appendChild(parent, anchor)
    return anchor
  }

  // Handle x-for directive
  if (attrs["x-for"]) {
    const forExpr = attrs["x-for"]
    const match = /^(\w+)\s+in\s+(.+)$/.exec(forExpr)
    if (!match) {
      console.error("[xml-runtime] Invalid x-for syntax:", forExpr)
      return element
    }

    const [, itemName, listExpr] = match
    const keyExpr = attrs["x-key"]
    const anchor = createTextNode("", parent)
    const renderedItems: Map<any, any> = new Map()

    reactiveApply(() => {
      try {
        const list: any[] = evalInScope(listExpr, scope) || []
        const newKeys = new Set<any>()

        for (let i = 0; i < list.length; i++) {
          const item = list[i]
          const itemScope = Object.create(scope)
          itemScope[itemName] = item
          itemScope.$index = i

          const key = keyExpr ? evalInScope(keyExpr, itemScope) : i
          newKeys.add(key)

          if (!renderedItems.has(key)) {
            // Create new item element
            const itemElement = createOpenTUIElement(node.tag || "box", parent)

            // Apply attributes (excluding x-for and x-key)
            for (const [name, value] of Object.entries(attrs)) {
              if (name === "x-for" || name === "x-key") continue
              applyAttribute(itemElement, name, value, itemScope)
            }

            // Render children with item scope
            if (node.children) {
              for (const child of node.children) {
                renderNode(child, itemElement, itemScope)
              }
            }

            appendChild(parent, itemElement)
            renderedItems.set(key, itemElement)
          }
        }

        // Remove items not in new list
        for (const [key, itemElement] of renderedItems.entries()) {
          if (!newKeys.has(key)) {
            if (itemElement.remove && typeof itemElement.remove === "function") {
              itemElement.remove()
            }
            renderedItems.delete(key)
          }
        }
      } catch (error) {
        console.error("[xml-runtime] Error in x-for:", error)
      }
    })

    appendChild(parent, anchor)
    return anchor
  }

  // Apply attributes
  for (const [name, value] of Object.entries(attrs)) {
    applyAttribute(element, name, value, scope)
  }

  // Render children
  if (node.children) {
    for (const child of node.children) {
      renderNode(child, element, scope)
    }
  }

  appendChild(parent, element)
  return element
}

function applyAttribute(element: any, name: string, value: string, scope: Record<string, any>) {
  // Event handlers
  if (isEventAttr(name)) {
    const eventName = toEventName(name)
    const handler = () => {
      try {
        evalInScope(value, scope)
      } catch (error) {
        console.error("[xml-runtime] Error in event handler:", error)
      }
    }

    if (element.addEventListener) {
      element.addEventListener(eventName, handler)
    } else if (element.on) {
      element.on(eventName, handler)
    }
    return
  }

  // Two-way binding
  if (isBindAttr(name)) {
    const prop = name.slice(5) // bind:value -> value
    const sigName = value.trim()
    const getter = (scope as any)[sigName] as Accessor<any> | undefined
    const setter = scope.set?.[sigName] as Setter<any> | undefined

    if (typeof getter === "function") {
      reactiveApply(() => {
        const val = getter()
        setElementProp(element, prop, val)
      })
    }

    if (setter) {
      const eventName = prop === "checked" ? "change" : "input"
      const handler = () => {
        const val = element[prop] || element.props?.[prop]
        if (val !== undefined) {
          setter(val)
        }
      }

      if (element.addEventListener) {
        element.addEventListener(eventName, handler)
      } else if (element.on) {
        element.on(eventName, handler)
      }
    }
    return
  }

  // Reactive attributes with expressions
  if (value.includes("{")) {
    reactiveApply(() => {
      try {
        const resolved = value.replace(/\{([^}]+)\}/g, (_, expr) => {
          const val = evalInScope(expr.trim(), scope)
          return val == null ? "" : String(val)
        })
        setElementProp(element, name, resolved)
      } catch (error) {
        console.error("[xml-runtime] Error in reactive attribute:", error)
      }
    })
    return
  }

  // Static attribute
  setElementProp(element, name, value)
}

// -----------------------------
// 5) Public API
// -----------------------------
export function signals<K extends string>(keys: K[], initial: Partial<Record<K, any>> = {}) {
  const get: Record<K, any> = Object.create(null)
  const set: Record<K, any> = Object.create(null)
  for (const k of keys) {
    const sig = createSignal(initial[k] as any)
    get[k] = sig[0]
    set[k] = sig[1]
  }
  return { ...get, set } as Record<K, Accessor<any>> & { set: Record<K, Setter<any>> }
}

export type RenderContext = Record<string, any> & {
  set?: Record<string, Setter<any>>
}

export type RenderHandle = {
  root: any
  dispose: () => void
}

export function renderXML(xml: string, mount: any, context: RenderContext = {}): RenderHandle {
  const scope = { ...context, Math, Date, Number, String, Boolean, Array, console }
  const disposers: Array<() => void> = []

  // Parse XML
  const nodes = parseXML(xml)

  // Render nodes
  for (const node of nodes) {
    renderNode(node, mount, scope)
  }

  return {
    root: mount,
    dispose: () => {
      for (const d of disposers) {
        try {
          d()
        } catch {}
      }
    },
  }
}
