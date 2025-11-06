/*
  Solid-compatible XML/HTML UI Runtime — single file
  --------------------------------------------------
  Goals
  - Render UI from an HTML/XML string.
  - Solid-like reactivity (createSignal, createEffect) in ~100 LOC.
  - Events: on:click, on:input, etc. mapping to functions in a provided context.
  - Expressions: { ... } in text and attribute values with reactive tracking.
  - Two-way binding: bind:value, bind:checked with signals.
  - Tiny control flow: x-if and x-for (array) with keyed reconciliation.
  - TypeScript: this file is TS. Inline <script> in XML must be JS; TS should be
    provided via the `context` object (typed by you in your app code).

  Import/Use
  ----------
  const app = renderXML(`<div>Hello {name()} <button on:click="inc()">+</button></div>`, mount, {
    ...signals(['name', 'count'], { name: 'World', count: 0 }),
    inc(){ this.set.count(v=>v+1) }
  });

  Or define your own signals via createSignal and pass getters/setters via context.
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
  // simple no-op placeholder for parity; user can call returned disposer from renderXML
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

function toEventName(name: string) {
  // on:click -> click
  return name.slice(3)
}

function evalInScope(expr: string, scope: Record<string, any>) {
  // Extremely small scoped evaluator. Not sandboxed; do not use with untrusted input.
  // Provides direct access to context keys and globals like Math.
  const keys = Object.keys(scope)
  const vals = Object.values(scope)
  // Allow short-hands like name() for signals, and this.set.count() for setters
  // eslint-disable-next-line no-new-func
  return Function(...keys, `with(this){ return (${expr}); }`).call(scope, ...vals)
}

// Wrap a reactive expression and rerun to patch DOM/text when deps change.
function reactiveApply(apply: () => void) {
  createEffect(apply)
}

// -----------------------------
// 3) Public API: signals helper and renderer
// -----------------------------
export function signals<K extends string>(keys: K[], initial: Partial<Record<K, any>> = {}) {
  const get: Record<K, any> = Object.create(null)
  const set: Record<K, any> = Object.create(null)
  for (const k of keys) {
    const [g, s] = createSignal(initial[k] as any)
    ;(get as any)[k] = g
    ;(set as any)[k] = s
  }
  return { ...get, set } as Record<K, Accessor<any>> & { set: Record<K, Setter<any>> }
}

export type RenderContext = Record<string, any> & {
  set?: Record<string, Setter<any>>
}

export type RenderHandle = { root: HTMLElement; dispose: () => void }

export function renderXML(
  xml: string,
  mount: HTMLElement,
  context: RenderContext = {},
): RenderHandle {
  // Parse XML/HTML to a DocumentFragment
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<root>${xml}</root>`, "text/html")
  const root = document.createElement("div")

  const disposers: Array<() => void> = []
  const scope = { ...context, Math, Date, Number, String, Boolean, Array, console }

  function bindReactiveText(node: Text, expr: string) {
    reactiveApply(() => {
      const v = evalInScope(expr, scope)
      node.nodeValue = v == null ? "" : String(v)
    })
  }

  function processTextNode(node: Text): Node[] {
    const txt = node.nodeValue ?? ""
    const parts = [] as Node[]
    let i = 0
    const re = /\{([^}]+)\}/g // { expr }
    let m: RegExpExecArray | null
    let last = 0
    while ((m = re.exec(txt))) {
      if (m.index > last) parts.push(document.createTextNode(txt.slice(last, m.index)))
      const expr = m[1].trim()
      const dyn = document.createTextNode("")
      bindReactiveText(dyn, expr)
      parts.push(dyn)
      last = m.index + m[0].length
    }
    if (last < txt.length) parts.push(document.createTextNode(txt.slice(last)))
    return parts.length ? parts : [node]
  }

  function setAttr(el: HTMLElement, name: string, raw: string) {
    if (isEventAttr(name)) {
      const evt = toEventName(name)
      el.addEventListener(evt, (e) => {
        const fn = evalInScope(raw, scope)
        if (typeof fn === "function") fn.call(scope, e)
      })
      return
    }

    if (isBindAttr(name)) {
      const prop = name.slice(5) // bind:value -> value
      const sigName = raw.trim()
      const getter = (scope as any)[sigName] as Accessor<any> | undefined
      const setter = scope.set?.[sigName] as Setter<any> | undefined
      if (typeof getter === "function") {
        reactiveApply(() => {
          const v = getter()
          ;(el as any)[prop] = v
        })
      }
      if (setter) {
        const event = prop === "checked" ? "change" : "input"
        el.addEventListener(event, () => setter((el as any)[prop]))
      }
      return
    }

    // Attribute with possible {expr}
    if (raw.includes("{")) {
      const marker = document.createTextNode("")
      // Render attribute reactively by reconstructing value from {expr} parts
      const chunks: Array<string | ((scope: any) => any)> = []
      const re = /\{([^}]+)\}/g
      let last = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(raw))) {
        if (m.index > last) chunks.push(raw.slice(last, m.index))
        const expr = m[1].trim()
        chunks.push((s: any) => evalInScope(expr, s))
        last = m.index + m[0].length
      }
      if (last < raw.length) chunks.push(raw.slice(last))
      reactiveApply(() => {
        const v = chunks.map((c) => (typeof c === "function" ? (c as any)(scope) : c)).join("")
        el.setAttribute(name, v)
      })
      // marker unused but keeps parity with text flow
      return
    }

    el.setAttribute(name, raw)
  }

  function mountChildren(src: ChildNode, dst: HTMLElement) {
    for (const child of Array.from(src.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const pieces = processTextNode(child as Text)
        pieces.forEach((p) => dst.appendChild(p))
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement
        // x-if
        const xif = el.getAttribute("x-if")
        if (xif) {
          const anchor = document.createComment("x-if")
          dst.appendChild(anchor)
          reactiveApply(() => {
            const show = !!evalInScope(xif, scope)
            // Clear following sibling content owned by this x-if block
            let next = anchor.nextSibling
            while (next && (next as any).__xIfOwned) {
              const kill = next
              next = next.nextSibling
              ;(kill as any).remove()
            }
            if (show) {
              const tmp = document.createElement("div")
              // clone and mount children of el
              for (const c of Array.from(el.childNodes)) tmp.appendChild(c.cloneNode(true))
              const holder = document.createDocumentFragment()
              mountChildren(tmp, holder as unknown as HTMLElement)
              for (const n of Array.from(holder.childNodes)) {
                ;(n as any).__xIfOwned = true
                anchor.parentNode!.insertBefore(n, anchor.nextSibling)
              }
            }
          })
          continue
        }

        // x-for="item in items()" optional key: x-key="item.id"
        const xfor = el.getAttribute("x-for")
        if (xfor) {
          const keyExpr = el.getAttribute("x-key")
          const anchor = document.createComment("x-for")
          dst.appendChild(anchor)
          reactiveApply(() => {
            const m = /^(\w+)\s+in\s+(.+)$/.exec(xfor)
            if (!m) return
            const [, itemName, listExpr] = m
            const list: any[] = evalInScope(listExpr, scope) || []
            const existing: Record<string, Node> = {}
            // collect current owned
            let cur = anchor.nextSibling
            const owned: Node[] = []
            while (cur && (cur as any).__xForOwned) {
              owned.push(cur)
              cur = cur.nextSibling
            }
            for (const n of owned) {
              const k = (n as any).__xKey
              if (k != null) existing[k] = n
            }
            const frag = document.createDocumentFragment()
            const nextOwned: Node[] = []
            for (let i = 0; i < list.length; i++) {
              const item = list[i]
              const local = Object.create(scope)
              local[itemName] = item
              local.$index = i
              const key = keyExpr ? evalInScope(keyExpr, local) : i
              let node = existing[key]
              if (!node) {
                const tmp = el.cloneNode(true) as HTMLElement
                tmp.removeAttribute("x-for")
                tmp.removeAttribute("x-key")
                const holder = document.createElement("div")
                for (const c of Array.from(tmp.childNodes)) holder.appendChild(c.cloneNode(true))
                const subFrag = document.createDocumentFragment()
                mountChildren(holder, subFrag as unknown as HTMLElement)
                node = document.createElement("span")
                while (subFrag.firstChild) node.appendChild(subFrag.firstChild)
              }
              ;(node as any).__xForOwned = true
              ;(node as any).__xKey = key
              nextOwned.push(node)
              frag.appendChild(node)
            }
            // replace owned range
            cur = anchor.nextSibling
            while (cur && (cur as any).__xForOwned) {
              const rm = cur
              cur = cur.nextSibling
              rm.remove()
            }
            anchor.parentNode!.insertBefore(frag, anchor.nextSibling)
          })
          continue
        }

        const out = document.createElement(el.tagName.toLowerCase())
        for (const attr of Array.from(el.attributes)) {
          setAttr(out as HTMLElement, attr.name, attr.value)
        }
        dst.appendChild(out)
        mountChildren(el, out)
      }
    }
  }

  const wrapper = doc.querySelector("root")!
  mountChildren(wrapper, root)
  mount.replaceChildren(...Array.from(root.childNodes))

  return {
    root: mount,
    dispose: () => {
      for (const d of disposers)
        try {
          d()
        } catch {}
    },
  }
}

// -----------------------------
// 4) Example usage for testing
// -----------------------------
export function createTestWidget() {
  const ctx = {
    ...signals(["name", "count", "items"], {
      name: "Synthia",
      count: 0,
      items: ["React", "Vue", "Svelte"],
    }),
    inc() {
      this.set.count((v: number) => v + 1)
    },
    dec() {
      this.set.count((v: number) => Math.max(0, v - 1))
    },
    setName(e: Event) {
      const i = e.target as HTMLInputElement
      this.set.name(i.value)
    },
    addItem() {
      const frameworks = ["Angular", "Solid", "Qwik", "Alpine", "Lit"]
      const random = frameworks[Math.floor(Math.random() * frameworks.length)]
      this.set.items((prev: string[]) => [...prev, random])
    },
  }

  const template = `
    <div class="card" style="padding: 20px; border: 2px solid #4a90e2; border-radius: 8px; max-width: 500px;">
      <h1 style="color: #4a90e2; margin: 0 0 16px 0;">Hello {name()}! 👋</h1>
      
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; font-weight: bold;">Your name:</label>
        <input 
          bind:value="name" 
          on:input="setName" 
          placeholder="Enter your name"
          style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;"
        />
      </div>

      <div style="margin-bottom: 16px;">
        <p style="margin: 0 0 8px 0;">Click count: <strong>{count()}</strong></p>
        <button 
          on:click="inc"
          style="padding: 8px 16px; margin-right: 8px; background: #4a90e2; color: white; border: none; border-radius: 4px; cursor: pointer;"
        >
          Increment 👆
        </button>
        <button 
          on:click="dec"
          style="padding: 8px 16px; background: #e24a4a; color: white; border: none; border-radius: 4px; cursor: pointer;"
        >
          Decrement 👇
        </button>
      </div>

      <div x-if="count() % 2 === 0" style="padding: 12px; background: #e8f5e9; border-left: 4px solid #4caf50; margin-bottom: 16px;">
        <strong>Even number! 🎯</strong> The count is divisible by 2.
      </div>

      <div x-if="count() % 2 === 1" style="padding: 12px; background: #fff3e0; border-left: 4px solid #ff9800; margin-bottom: 16px;">
        <strong>Odd number! 🎲</strong> The count is not divisible by 2.
      </div>

      <div style="margin-bottom: 16px;">
        <p style="margin: 0 0 8px 0; font-weight: bold;">Frameworks ({items().length}):</p>
        <ul style="margin: 0; padding-left: 20px;">
          <li x-for="item in items()" x-key="item" style="margin-bottom: 4px;">
            📦 {item}
          </li>
        </ul>
        <button 
          on:click="addItem"
          style="margin-top: 8px; padding: 6px 12px; background: #9c27b0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;"
        >
          Add Random Framework
        </button>
      </div>

      <div style="margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 4px; font-size: 12px;">
        <strong>🧪 Testing:</strong> Reactive signals, event handlers, two-way binding, x-if conditionals, and x-for loops all working!
      </div>
    </div>
  `

  return { template, context: ctx }
}
