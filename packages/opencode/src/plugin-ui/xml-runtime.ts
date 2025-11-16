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

// -----------------------------
// SECURITY: Safe Expression Parser
// -----------------------------

// Whitelist of allowed global functions/objects
const ALLOWED_GLOBALS = new Set([
  "Math",
  "Date",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "JSON",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURI",
  "decodeURI",
  "encodeURIComponent",
  "decodeURIComponent",
])

// Dangerous patterns that should never appear in expressions
const DANGEROUS_PATTERNS = [
  /\bconstructor\b/i, // Access to constructor
  /\b__proto__\b/i, // Prototype pollution
  /\bprototype\b/i, // Direct prototype access
  /\beval\b/i, // eval function
  /\bFunction\b/i, // Function constructor
  /\bimport\b/i, // Dynamic imports
  /\brequire\b/i, // CommonJS require
  /\bprocess\b/i, // Node.js process
  /\bglobalThis\b/i, // Global object access
  /\bwindow\b/i, // Browser window
  /\bdocument\b/i, // DOM access (for security)
  /\bsetTimeout\b/i, // Async execution
  /\bsetInterval\b/i, // Async execution
  /\bsetImmediate\b/i, // Async execution
  /\bfetch\b/i, // Network requests
  /\bXMLHttpRequest\b/i, // Network requests
  /\bWebSocket\b/i, // Network connections
  /\bexec\b/i, // Command execution patterns
  /\bspawn\b/i, // Process spawning
  /\bchild_process\b/i, // Child process module
  /\bfs\b\s*\./, // File system access
  /\bmodule\b/, // Module system
  /\bexports\b/, // Module exports
  /\b__dirname\b/, // Directory access
  /\b__filename\b/, // File access
]

// Maximum expression length to prevent DoS
const MAX_EXPR_LENGTH = 500

// Maximum nesting depth for property access
const MAX_DEPTH = 10

// Expression validation result
interface ValidationResult {
  valid: boolean
  error?: string
}

// Validate expression for security issues
function validateExpression(expr: string): ValidationResult {
  // Check length
  if (expr.length > MAX_EXPR_LENGTH) {
    return { valid: false, error: `Expression too long (max ${MAX_EXPR_LENGTH} chars)` }
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(expr)) {
      return { valid: false, error: `Dangerous pattern detected: ${pattern.source}` }
    }
  }

  // Check for assignment operators (prevent side effects)
  if (/(?<![=!<>])=(?![=])/.test(expr) && !expr.includes("==") && !expr.includes("===")) {
    // Allow == and === but not single =
    const assignMatch = expr.match(/(?<![=!<>])=(?![=])/)
    if (assignMatch && !expr.includes("=>")) {
      // Allow arrow functions
      return { valid: false, error: "Assignment operators not allowed in expressions" }
    }
  }

  // Check for function definitions
  if (/\bfunction\s*\(/.test(expr) || /=>\s*\{/.test(expr)) {
    return { valid: false, error: "Function definitions not allowed in expressions" }
  }

  return { valid: true }
}

// Parse a simple property access path (e.g., "user.name" or "items[0].title")
function parsePath(path: string): string[] {
  const parts: string[] = []
  let current = ""
  let depth = 0
  let inBracket = false

  for (let i = 0; i < path.length; i++) {
    const char = path[i]

    if (char === "[" && !inBracket) {
      if (current) {
        parts.push(current)
        current = ""
      }
      inBracket = true
      depth++
    } else if (char === "]" && inBracket) {
      depth--
      if (depth === 0) {
        inBracket = false
        // Remove quotes if present
        const key = current.trim().replace(/^["']|["']$/g, "")
        parts.push(key)
        current = ""
      } else {
        current += char
      }
    } else if (char === "." && !inBracket && depth === 0) {
      if (current) {
        parts.push(current)
        current = ""
      }
    } else {
      current += char
    }

    if (parts.length > MAX_DEPTH) {
      throw new Error(`Property access depth exceeded (max ${MAX_DEPTH})`)
    }
  }

  if (current) {
    parts.push(current)
  }

  return parts
}

// Safely get a value from scope by path
function safeGetPath(path: string[], scope: Record<string, any>): any {
  let current: any = scope

  for (const part of path) {
    if (current == null) {
      return undefined
    }

    // Prevent prototype pollution
    if (part === "__proto__" || part === "constructor" || part === "prototype") {
      throw new Error(`Access to '${part}' is forbidden`)
    }

    // Check if it's an array index
    const index = parseInt(part, 10)
    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index]
    } else if (typeof current === "object" && current !== null) {
      current = current[part]
    } else {
      return undefined
    }
  }

  return current
}

// Safe expression evaluator - only supports basic operations
function safeEvalExpression(expr: string, scope: Record<string, any>): any {
  expr = expr.trim()

  // Validate expression first
  const validation = validateExpression(expr)
  if (!validation.valid) {
    throw new Error(`Invalid expression: ${validation.error}`)
  }

  // Handle empty expression
  if (!expr) {
    return undefined
  }

  // Handle string literals
  if (/^["'].*["']$/.test(expr)) {
    return expr.slice(1, -1)
  }

  // Handle number literals
  if (/^-?\d+(\.\d+)?$/.test(expr)) {
    return parseFloat(expr)
  }

  // Handle boolean literals
  if (expr === "true") return true
  if (expr === "false") return false
  if (expr === "null") return null
  if (expr === "undefined") return undefined

  // Handle ternary operator: condition ? trueVal : falseVal
  const ternaryMatch = expr.match(/^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$/)
  if (ternaryMatch) {
    const [, condExpr, trueExpr, falseExpr] = ternaryMatch
    const condition = safeEvalExpression(condExpr, scope)
    return condition ? safeEvalExpression(trueExpr, scope) : safeEvalExpression(falseExpr, scope)
  }

  // Handle logical OR: a || b
  if (expr.includes("||")) {
    const parts = expr.split("||").map((p) => p.trim())
    for (const part of parts) {
      const val = safeEvalExpression(part, scope)
      if (val) return val
    }
    return false
  }

  // Handle logical AND: a && b
  if (expr.includes("&&")) {
    const parts = expr.split("&&").map((p) => p.trim())
    let result: any = true
    for (const part of parts) {
      result = safeEvalExpression(part, scope)
      if (!result) return result
    }
    return result
  }

  // Handle comparison operators
  const comparisonOps = ["===", "!==", "==", "!=", "<=", ">=", "<", ">"]
  for (const op of comparisonOps) {
    const idx = expr.indexOf(op)
    if (idx !== -1) {
      const left = safeEvalExpression(expr.slice(0, idx), scope)
      const right = safeEvalExpression(expr.slice(idx + op.length), scope)
      switch (op) {
        case "===":
          return left === right
        case "!==":
          return left !== right
        case "==":
          return left == right
        case "!=":
          return left != right
        case "<=":
          return left <= right
        case ">=":
          return left >= right
        case "<":
          return left < right
        case ">":
          return left > right
      }
    }
  }

  // Handle arithmetic operators (simple cases)
  if (expr.includes("+") && !expr.includes("++")) {
    const parts = expr.split("+").map((p) => p.trim())
    const firstVal = safeEvalExpression(parts[0], scope)
    return parts.slice(1).reduce((acc: string | number, part: string) => {
      const val = safeEvalExpression(part, scope)
      return typeof acc === "number" && typeof val === "number" ? acc + val : String(acc) + String(val)
    }, firstVal as string | number)
  }

  if (expr.includes("-") && !expr.includes("--") && !expr.startsWith("-")) {
    const parts = expr.split("-").map((p) => p.trim())
    return parts.reduce((acc, part, i) => {
      const val = safeEvalExpression(part, scope)
      return i === 0 ? val : acc - val
    }, 0)
  }

  if (expr.includes("*") && !expr.includes("**")) {
    const parts = expr.split("*").map((p) => p.trim())
    return parts.reduce((acc, part) => {
      const val = safeEvalExpression(part, scope)
      return acc * val
    }, 1)
  }

  if (expr.includes("/")) {
    const parts = expr.split("/").map((p) => p.trim())
    return parts.reduce((acc, part, i) => {
      const val = safeEvalExpression(part, scope)
      return i === 0 ? val : acc / val
    }, 0)
  }

  if (expr.includes("%")) {
    const parts = expr.split("%").map((p) => p.trim())
    return parts.reduce((acc, part, i) => {
      const val = safeEvalExpression(part, scope)
      return i === 0 ? val : acc % val
    }, 0)
  }

  // Handle logical NOT: !value
  if (expr.startsWith("!")) {
    return !safeEvalExpression(expr.slice(1), scope)
  }

  // Handle parentheses
  if (expr.startsWith("(") && expr.endsWith(")")) {
    return safeEvalExpression(expr.slice(1, -1), scope)
  }

  // Handle function calls: func() or obj.method()
  const funcCallMatch = expr.match(/^([\w.]+)\((.*)\)$/)
  if (funcCallMatch) {
    const [, funcPath, argsStr] = funcCallMatch
    const pathParts = parsePath(funcPath)
    const func = safeGetPath(pathParts, scope)

    if (typeof func !== "function") {
      throw new Error(`'${funcPath}' is not a function`)
    }

    // Parse arguments (simple comma-separated values)
    const args: any[] = []
    if (argsStr.trim()) {
      // Simple argument parsing (doesn't handle nested function calls)
      let depth = 0
      let current = ""
      for (const char of argsStr) {
        if (char === "(" || char === "[" || char === "{") depth++
        else if (char === ")" || char === "]" || char === "}") depth--

        if (char === "," && depth === 0) {
          args.push(safeEvalExpression(current.trim(), scope))
          current = ""
        } else {
          current += char
        }
      }
      if (current.trim()) {
        args.push(safeEvalExpression(current.trim(), scope))
      }
    }

    // Call the function with evaluated arguments
    return func(...args)
  }

  // Handle property access: obj.prop or obj[key]
  const pathParts = parsePath(expr)
  if (pathParts.length > 0) {
    return safeGetPath(pathParts, scope)
  }

  throw new Error(`Unable to evaluate expression: ${expr}`)
}

// Secure wrapper for evalInScope with logging
function evalInScope(expr: string, scope: Record<string, any>): any {
  try {
    return safeEvalExpression(expr, scope)
  } catch (error) {
    // Log security violations for auditing
    console.warn(`[xml-runtime] Expression evaluation blocked:`, {
      expression: expr.slice(0, 100), // Truncate for logging
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })
    throw error
  }
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
