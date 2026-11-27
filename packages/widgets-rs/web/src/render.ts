// View trees (widgets.md, Nodes) rendered to plain DOM and patched in place: a node of the same type at the same
// place keeps its element, so focus, a carousel's page, a slider being dragged and a canvas's clock survive updates.

import type { Command, Images } from "./canvas.js"
import type { GpuCanvas } from "./gpu.js"
import { canvasSize, GPU_HANG } from "./gpu-checks.js"
import { paint } from "./canvas.js"
import { markdown } from "./markdown.js"
import type { Frame, Rect, ViewNode, WidgetEvent } from "./protocol.js"
import { DRAW_BUDGET_MS, MAX_FPS, MAX_SHADER_BYTES, MAX_SHADER_VALUES, OVERRUNS_TO_FREEZE, SHADER_FRAME_BUDGET_MS } from "./protocol.js"
import type { ShaderError, Surface } from "./shader.js"
import type { Run } from "./watchdog.js"
import { UNIFORM_FLOATS, surface } from "./shader.js"
import type { Resolved } from "./theme.js"

/** What rendering needs from its widget. */
export interface RenderContext {
  readonly doc: Document
  emit(event: WidgetEvent): void
  readOnly(): boolean
  theme(): Resolved
  visible(): boolean
  fullscreen(): boolean
  /** The full-screen close button's area in viewport coordinates, or null when not full screen. */
  closeRect(): DOMRect | null
  images: Images
  resolveImage(src: string): string | undefined
  /** Step mode: run the draw step for `frame`. Live mode: undefined (commands arrive through `liveCommands`). */
  draw?(frame: Frame): Promise<{ commands?: Command[]; error?: string; ms: number }>
  liveCommands(id: string | null): Command[] | undefined
  /** A program warning that isn't an error (an unknown node type). */
  warn(message: string): void
  /** The widget template's code broke a contract here (WGSL that fails validation or over 16 KB, values without wgsl): reported. */
  programError(phase: string, error: { message: string; line?: number; column?: number }): void
  /** This host failed (valid WGSL it couldn't run, a surface too slow on this device): logged in dev mode only. */
  clientError(message: string, cause?: unknown): void
  /** The run (widgets-gpu.md, Strikes): its GPU work finished, or was unfinished at a device loss. The same each time. */
  readonly gpuRun: Run
  ticker: Ticker
}

/** One `requestAnimationFrame` loop for every animated surface on the page, running only while one wants frames. */
export class Ticker {
  private subs = new Set<(now: number) => void>()
  private handle = 0
  add(f: (now: number) => void) {
    this.subs.add(f)
    if (!this.handle) this.handle = requestAnimationFrame(this.tick)
  }
  delete(f: (now: number) => void) {
    this.subs.delete(f)
  }
  private tick = (now: number) => {
    this.handle = 0
    for (const f of [...this.subs]) f(now)
    if (this.subs.size > 0 && !this.handle) this.handle = requestAnimationFrame(this.tick)
  }
}

interface Rec {
  type: string
  node: ViewNode
  update(node: ViewNode): void
  destroy?(): void
}

const REC = new WeakMap<Element, Rec>()
const KNOWN = new Set([
  "column",
  "row",
  "text",
  "markdown",
  "image",
  "carousel",
  "card",
  "button",
  "checkbox",
  "slider",
  "select",
  "input",
  "divider",
  "table",
  "canvas",
  "stack",
])

const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v))
const finite = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d)
const children = (node: ViewNode): ViewNode[] => (Array.isArray(node.children) ? (node.children as ViewNode[]) : [])

/** Whether a `canvas` (2D or GPU) is in `node`'s tree. */
export function hasSurface(node: ViewNode | undefined): boolean {
  if (!node || typeof node !== "object") return false
  if (node.type === "canvas") return true
  return children(node).some(hasSurface)
}

function hasFill(node: ViewNode): boolean {
  // In full screen every canvas fills unless it says `fill: false`.
  if (node.type === "canvas" && node.fill !== false) return true
  return children(node).some((c) => c && typeof c === "object" && hasFill(c))
}

/**
 * A canvas with `wgsl` is drawn by its shader on the GPU, one with `gpu: true` by the program's WebGPU calls
 * (widgets-gpu.md), any other by `draw`: one way only, so never one element.
 */
function kind(node: ViewNode): string {
  if (node.type !== "canvas") return node.type
  return typeof node.wgsl === "string" ? "canvas:gpu" : node.gpu === true ? "canvas:webgpu" : "canvas"
}

/** Renders `nodes` as `parent`'s children, reusing elements of the same type at the same place. */
export function reconcile(ctx: RenderContext, parent: Element, nodes: readonly unknown[]) {
  const kids = parent.children
  let i = 0
  for (const node of nodes) {
    if (!node || typeof node !== "object" || !KNOWN.has((node as ViewNode).type)) {
      if (node && typeof node === "object") ctx.warn(`unknown node type ${JSON.stringify((node as ViewNode).type)}`)
      continue
    }
    const n = node as ViewNode
    const el = kids[i]
    const rec = el && REC.get(el)
    if (rec && rec.type === kind(n)) {
      rec.node = n
      rec.update(n)
    } else {
      const made = create(ctx, n)
      if (el) {
        destroy(el)
        parent.replaceChild(made, el)
      } else parent.appendChild(made)
    }
    i++
  }
  while (kids.length > i) {
    const el = kids[kids.length - 1]!
    destroy(el)
    el.remove()
  }
}

/** Releases what `el`'s subtree holds (timers, GPU surfaces, frame callbacks). */
export function destroy(el: Element) {
  REC.get(el)?.destroy?.()
  for (const d of el.querySelectorAll("[data-pw-live]")) REC.get(d)?.destroy?.()
}

function create(ctx: RenderContext, node: ViewNode): HTMLElement {
  const make = BUILDERS[node.type]!
  const { el, rec } = make(ctx, node)
  REC.set(el, rec)
  // Event handlers read the node from the record: it must be this one from the start, not only after an update.
  rec.node = node
  rec.update(node)
  return el
}

type Builder = (ctx: RenderContext, node: ViewNode) => { el: HTMLElement; rec: Rec }

function h<K extends keyof HTMLElementTagNameMap>(ctx: RenderContext, tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const el = ctx.doc.createElement(tag)
  if (cls) el.className = cls
  return el
}

function icon(ctx: RenderContext, path: string): SVGSVGElement {
  const svg = ctx.doc.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "1.8")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  const p = ctx.doc.createElementNS("http://www.w3.org/2000/svg", "path")
  p.setAttribute("d", path)
  svg.append(p)
  return svg
}
export { icon }

function setClass(el: Element, cls: string) {
  if (el.className !== cls) el.className = cls
}

function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text
}

function container(kind: "column" | "row"): Builder {
  return (ctx) => {
    const el = h(ctx, "div")
    const rec: Rec = {
      type: kind,
      node: { type: kind },
      update(n) {
        const gap = [0, 1, 2, 3].includes(n.gap as number) ? (n.gap as number) : kind === "column" ? 2 : 1
        // As Rune lays them out: a column stretches its children by default, a row aligns them at the start (and
        // reads `stretch` as `start`).
        const allowed = kind === "column" ? ["start", "center", "end", "stretch"] : ["start", "center", "end"]
        const align = allowed.includes(n.align as string) ? (n.align as string) : kind === "column" ? "stretch" : "start"
        setClass(
          el,
          `${kind === "column" ? "pw-col" : "pw-row"} pw-g${gap} pw-a-${align}${kind === "row" && n.wrap === true ? " pw-wrap" : ""}${hasFill(n) ? " pw-has-fill" : ""}`,
        )
        reconcile(ctx, el, children(n))
      },
    }
    return { el, rec }
  }
}

const BUILDERS: Record<string, Builder> = {
  column: container("column"),
  row: container("row"),
  text(ctx) {
    const el = h(ctx, "div")
    return {
      el,
      rec: {
        type: "text",
        node: { type: "text" },
        update(n) {
          const style = ["title", "body", "caption", "code"].includes(n.style as string) ? (n.style as string) : "body"
          const tone = ["muted", "accent", "success", "warning", "error"].includes(n.tone as string) ? ` pw-t-${n.tone}` : ""
          setClass(el, `pw-text pw-${style}${tone}`)
          if (style === "title") el.setAttribute("role", "heading")
          else el.removeAttribute("role")
          setText(el, str(n.text))
        },
      },
    }
  },
  markdown(ctx) {
    const el = h(ctx, "div", "pw-md")
    let text: string | undefined
    return {
      el,
      rec: {
        type: "markdown",
        node: { type: "markdown" },
        update(n) {
          const t = str(n.text)
          if (t === text) return
          text = t
          el.replaceChildren(markdown(t, ctx.doc))
        },
      },
    }
  },
  image(ctx) {
    const el = h(ctx, "div", "pw-imgbox")
    const img = h(ctx, "img", "pw-img")
    img.loading = "lazy"
    img.decoding = "async"
    img.referrerPolicy = "no-referrer"
    img.draggable = false
    const missing = h(ctx, "div", "pw-img pw-img-missing")
    let src: string | undefined
    const fail = () => {
      missing.textContent = img.alt || "Image unavailable"
      missing.style.aspectRatio = img.style.aspectRatio
      if (missing.parentNode !== el) el.replaceChildren(missing)
    }
    img.onerror = fail
    return {
      el,
      rec: {
        type: "image",
        node: { type: "image" },
        update(n) {
          const aspect = finite(n.aspect, 0)
          img.style.aspectRatio = aspect > 0 ? String(aspect) : ""
          img.alt = str(n.alt)
          const s = str(n.src)
          if (s === src) return
          src = s
          const url = ctx.resolveImage(s)
          if (!url) return fail()
          if (img.parentNode !== el) el.replaceChildren(img)
          img.src = url
        },
      },
    }
  },
  card(ctx) {
    const el = h(ctx, "div")
    const rec: Rec = {
      type: "card",
      node: { type: "card" },
      update(n) {
        const id = typeof n.id === "string" ? n.id : undefined
        setClass(el, `pw-card${id ? " pw-press" : ""}${n.selected === true ? " pw-selected" : ""}${hasFill(n) ? " pw-has-fill" : ""}`)
        if (id) {
          el.tabIndex = 0
          el.setAttribute("role", "button")
          el.setAttribute("aria-pressed", String(n.selected === true))
        } else {
          el.removeAttribute("tabindex")
          el.removeAttribute("role")
          el.removeAttribute("aria-pressed")
        }
        reconcile(ctx, el, children(n))
      },
    }
    const press = (e: Event) => {
      const id = rec.node.id
      if (typeof id !== "string" || ctx.readOnly()) return
      // A press on a control inside the card is that control's.
      const target = e.target as Element | null
      if (target && target !== el && target.closest("button, input, textarea, select, a, .pw-carousel, canvas")) return
      ctx.emit({ id, type: "press" })
    }
    el.addEventListener("click", press)
    el.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === el) {
        e.preventDefault()
        press(e)
      }
    })
    return { el, rec }
  },
  button(ctx) {
    const el = h(ctx, "button")
    el.type = "button"
    const rec: Rec = {
      type: "button",
      node: { type: "button" },
      update(n) {
        const variant = ["primary", "secondary", "danger"].includes(n.variant as string) ? (n.variant as string) : "secondary"
        setClass(el, `pw-btn pw-${variant}`)
        setText(el, str(n.label))
        el.disabled = n.disabled === true || ctx.readOnly()
      },
    }
    el.addEventListener("click", () => {
      if (!ctx.readOnly() && rec.node.disabled !== true) ctx.emit({ id: str(rec.node.id), type: "press" })
    })
    return { el, rec }
  },
  checkbox(ctx) {
    const el = h(ctx, "label", "pw-check")
    const input = h(ctx, "input")
    input.type = "checkbox"
    const span = h(ctx, "span")
    el.append(input, span)
    const rec: Rec = {
      type: "checkbox",
      node: { type: "checkbox" },
      update(n) {
        input.checked = n.checked === true
        input.disabled = n.disabled === true || ctx.readOnly()
        el.classList.toggle("pw-disabled", input.disabled)
        setText(span, str(n.label))
      },
    }
    input.addEventListener("change", () => ctx.emit({ id: str(rec.node.id), type: "change", value: input.checked }))
    return { el, rec }
  },
  slider(ctx) {
    const el = h(ctx, "div", "pw-field")
    const head = h(ctx, "div", "pw-slider-head")
    const label = h(ctx, "span", "pw-label")
    const shown = h(ctx, "span", "pw-slider-value")
    head.append(label, shown)
    const input = h(ctx, "input", "pw-slider")
    input.type = "range"
    el.append(head, input)
    let dragging = false
    const decimals = (step: number) => {
      const s = String(step)
      return s.includes(".") ? Math.min(6, s.length - s.indexOf(".") - 1) : 0
    }
    const show = () => {
      const step = input.step === "any" ? 0 : Number(input.step)
      shown.textContent = step > 0 ? Number(input.value).toFixed(decimals(step)) : String(Math.round(Number(input.value) * 100) / 100)
    }
    const rec: Rec = {
      type: "slider",
      node: { type: "slider" },
      update(n) {
        const min = finite(n.min, 0)
        const max = Math.max(min, finite(n.max, 100))
        // Without a step, whole-number bounds step by 1 (keyboard and drag), others move freely.
        const step = finite(n.step, 0) || (Number.isInteger(min) && Number.isInteger(max) && max - min >= 1 ? 1 : 0)
        input.min = String(min)
        input.max = String(max)
        input.step = step > 0 ? String(step) : "any"
        if (!dragging) input.value = String(finite(n.value, min))
        input.disabled = ctx.readOnly()
        setText(label, str(n.label))
        label.hidden = !n.label
        input.setAttribute("aria-label", str(n.label) || str(n.id))
        show()
      },
    }
    input.addEventListener("pointerdown", () => (dragging = true))
    input.addEventListener("input", show)
    // `change` fires on release (and on keyboard steps): the contract's "send on release".
    input.addEventListener("change", () => {
      dragging = false
      ctx.emit({ id: str(rec.node.id), type: "change", value: Number(input.value) })
    })
    return { el, rec }
  },
  select(ctx) {
    const el = h(ctx, "div", "pw-field")
    const label = h(ctx, "span", "pw-label")
    const list = h(ctx, "div", "pw-options")
    el.append(label, list)
    let chosen: string[] = []
    const rec: Rec = {
      type: "select",
      node: { type: "select" },
      update(n) {
        const multiple = n.multiple === true
        setText(label, str(n.label))
        label.hidden = !n.label
        list.setAttribute("role", multiple ? "group" : "radiogroup")
        if (n.label) list.setAttribute("aria-label", str(n.label))
        chosen = Array.isArray(n.value) ? n.value.map(str) : n.value === undefined || n.value === null ? [] : [str(n.value)]
        const options = (Array.isArray(n.options) ? n.options : []) as { value?: unknown; label?: unknown; description?: unknown }[]
        while (list.children.length > options.length) list.lastElementChild!.remove()
        options.forEach((o, i) => {
          let b = list.children[i] as HTMLButtonElement | undefined
          if (!b) {
            b = h(ctx, "button")
            b.type = "button"
            b.append(h(ctx, "span", "pw-mark"))
            const text = h(ctx, "span", "pw-option-text")
            text.append(h(ctx, "span"), h(ctx, "span", "pw-option-desc"))
            b.append(text)
            b.addEventListener("click", () => pick(Number(b!.dataset.index)))
            list.append(b)
          }
          b.dataset.index = String(i)
          b.dataset.value = str(o?.value)
          setClass(b, `pw-option${multiple ? " pw-multi" : ""}`)
          b.setAttribute("role", multiple ? "checkbox" : "radio")
          b.setAttribute("aria-checked", String(chosen.includes(str(o?.value))))
          b.disabled = ctx.readOnly()
          const [title, desc] = b.lastElementChild!.children as unknown as [HTMLElement, HTMLElement]
          setText(title, str(o?.label ?? o?.value))
          setText(desc, str(o?.description))
          desc.hidden = !o?.description
        })
      },
    }
    const pick = (i: number) => {
      if (ctx.readOnly()) return
      const b = list.children[i] as HTMLElement | undefined
      const value = b?.dataset.value
      if (value === undefined) return
      if (rec.node.multiple === true) {
        const next = chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value]
        b!.setAttribute("aria-checked", String(next.includes(value)))
        chosen = next
        ctx.emit({ id: str(rec.node.id), type: "change", value: next })
      } else {
        for (const o of list.children) o.setAttribute("aria-checked", String(o === b))
        chosen = [value]
        ctx.emit({ id: str(rec.node.id), type: "change", value })
      }
    }
    return { el, rec }
  },
  input(ctx, node) {
    const el = h(ctx, "label", "pw-field")
    el.dataset.pwLive = ""
    const label = h(ctx, "span", "pw-label")
    let field: HTMLInputElement | HTMLTextAreaElement
    let multiline = node.multiline === true
    let timer: ReturnType<typeof setTimeout> | undefined
    let sent: string | undefined
    let shown: unknown
    const commit = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      if (field.value === sent || ctx.readOnly()) return
      sent = field.value
      ctx.emit({ id: str(rec.node.id), type: "change", value: field.value })
    }
    const make = () => {
      field = multiline ? h(ctx, "textarea", "pw-input") : h(ctx, "input", "pw-input")
      if (field instanceof HTMLTextAreaElement) field.rows = 3
      field.addEventListener("input", () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(commit, 300)
      })
      field.addEventListener("blur", commit)
      field.addEventListener("keydown", (e) => {
        const k = e as KeyboardEvent
        if (k.key === "Enter" && (!multiline || k.metaKey || k.ctrlKey)) commit()
      })
      el.replaceChildren(label, field)
    }
    make()
    const rec: Rec = {
      type: "input",
      node: { type: "input" },
      update(n) {
        if ((n.multiline === true) !== multiline) {
          multiline = n.multiline === true
          make()
        }
        setText(label, str(n.label))
        label.hidden = !n.label
        field.placeholder = str(n.placeholder)
        field.readOnly = ctx.readOnly()
        const value = str(n.value)
        // Keep what the user is typing: take the program's value when it changed it, or when the field isn't focused.
        const focused = ctx.doc.activeElement === field || (field.getRootNode() as ShadowRoot).activeElement === field
        if (field.value !== value && (!focused || (value !== shown && value !== sent))) {
          field.value = value
          sent = value
        }
        if (sent === undefined) sent = value
        shown = value
      },
      destroy() {
        if (timer !== undefined) clearTimeout(timer)
      },
    }
    return { el, rec }
  },
  // A table (widgets.md, Table): a header with the sort indicator, rows as text, scrolling sideways when it is wider
  // than the widget; a row press sends `press` with its index and a header press `change` with the column's.
  table(ctx) {
    const el = h(ctx, "div", "pw-table")
    const rec: Rec = {
      type: "table",
      node: { type: "table" },
      update(n) {
        const columns = (Array.isArray(n.columns) ? n.columns : []) as { label?: unknown; align?: unknown }[]
        const rows = (Array.isArray(n.rows) ? n.rows : []) as unknown[][]
        const sort = n.sort as { column?: unknown; descending?: unknown } | undefined
        const table = h(ctx, "table")
        const head = table.createTHead().insertRow()
        columns.forEach((column, index) => {
          const cell = h(ctx, "th")
          cell.textContent = str(column.label)
          if (sort?.column === index) cell.textContent += sort.descending === true ? " ▼" : " ▲"
          if (column.align === "end") cell.className = "pw-end"
          if (n.sortable === true && !ctx.readOnly()) {
            cell.classList.add("pw-press")
            cell.addEventListener("click", () => ctx.emit({ id: str(rec.node.id), type: "change", value: index }))
          }
          head.append(cell)
        })
        const body = table.createTBody()
        rows.forEach((cells, row) => {
          const tr = body.insertRow()
          if (n.selected === row) tr.className = "pw-on"
          if (n.selectable === true && !ctx.readOnly()) {
            tr.classList.add("pw-press")
            tr.addEventListener("click", () => ctx.emit({ id: str(rec.node.id), type: "press", value: row }))
          }
          columns.forEach((column, index) => {
            const cell = tr.insertCell()
            cell.textContent = str(Array.isArray(cells) ? cells[index] : undefined)
            if (column.align === "end") cell.className = "pw-end"
          })
        })
        el.replaceChildren(table)
      },
    }
    return { el, rec }
  },
  divider(ctx) {
    const el = h(ctx, "hr", "pw-divider")
    return { el, rec: { type: "divider", node: { type: "divider" }, update() {} } }
  },
  carousel(ctx) {
    const el = h(ctx, "div", "pw-carousel")
    el.tabIndex = 0
    el.setAttribute("role", "region")
    el.setAttribute("aria-roledescription", "carousel")
    const track = h(ctx, "div", "pw-track")
    const prev = h(ctx, "button", "pw-arrow pw-prev")
    const next = h(ctx, "button", "pw-arrow pw-next")
    prev.type = next.type = "button"
    prev.setAttribute("aria-label", "Previous")
    next.setAttribute("aria-label", "Next")
    prev.append(icon(ctx, "M10 3 5 8l5 5"))
    next.append(icon(ctx, "M6 3l5 5-5 5"))
    const dots = h(ctx, "div", "pw-dots")
    el.append(track, prev, next, dots)
    let index = 0
    let count = 0
    let given: number | undefined
    const layout = (offset = 0) => {
      track.style.transform = `translateX(calc(${-index * 100}% + ${offset}px))`
      prev.disabled = index <= 0
      next.disabled = index >= count - 1
      for (let i = 0; i < dots.children.length; i++) dots.children[i]!.classList.toggle("pw-on", i === index)
      for (let i = 0; i < track.children.length; i++) track.children[i]!.setAttribute("aria-hidden", String(i !== index))
    }
    const go = (to: number) => {
      const target = Math.max(0, Math.min(count - 1, to))
      if (target === index) return layout()
      index = target
      layout()
      const id = rec.node.id
      if (typeof id === "string" && !ctx.readOnly()) ctx.emit({ id, type: "change", value: index })
    }
    const rec: Rec = {
      type: "carousel",
      node: { type: "carousel" },
      update(n) {
        const nodes = children(n).filter((c) => c && typeof c === "object" && KNOWN.has(c.type))
        count = nodes.length
        while (track.children.length > count) {
          destroy(track.lastElementChild!)
          track.lastElementChild!.remove()
        }
        nodes.forEach((c, i) => {
          let slide = track.children[i]
          if (!slide) {
            slide = h(ctx, "div", "pw-slide")
            track.append(slide)
          }
          reconcile(ctx, slide, [c])
        })
        while (dots.children.length > count) dots.lastElementChild!.remove()
        while (dots.children.length < count) {
          const d = h(ctx, "button", "pw-dot")
          d.type = "button"
          const i = dots.children.length
          d.setAttribute("aria-label", `Page ${i + 1}`)
          d.addEventListener("click", () => go(i))
          dots.append(d)
        }
        dots.hidden = prev.hidden = next.hidden = count < 2
        el.toggleAttribute("data-id", typeof n.id === "string")
        const want = typeof n.index === "number" ? n.index : undefined
        if (want !== undefined && want !== given) index = want
        given = want
        index = Math.max(0, Math.min(Math.max(0, count - 1), index))
        layout()
      },
    }
    prev.addEventListener("click", (e) => {
      e.stopPropagation()
      go(index - 1)
    })
    next.addEventListener("click", (e) => {
      e.stopPropagation()
      go(index + 1)
    })
    el.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") go(index - 1)
      else if (e.key === "ArrowRight") go(index + 1)
      else return
      e.preventDefault()
    })
    // Swipe: horizontal drags page; vertical ones scroll the page (`touch-action: pan-y`).
    let start: { x: number; y: number; id: number } | undefined
    let dx = 0
    el.addEventListener("pointerdown", (e) => {
      if (count < 2 || (e.target as Element).closest("button")) return
      start = { x: e.clientX, y: e.clientY, id: e.pointerId }
      dx = 0
    })
    el.addEventListener("pointermove", (e) => {
      if (!start || e.pointerId !== start.id) return
      dx = e.clientX - start.x
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
        if (!track.classList.contains("pw-dragging")) {
          track.classList.add("pw-dragging")
          el.setPointerCapture(e.pointerId)
        }
        const edge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0)
        layout(edge ? dx / 3 : dx)
      }
    })
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dragged = track.classList.contains("pw-dragging")
      track.classList.remove("pw-dragging")
      start = undefined
      if (!dragged) return
      const width = el.clientWidth || 1
      if (Math.abs(dx) > Math.min(60, width / 5)) go(index + (dx < 0 ? 1 : -1))
      else layout()
      // A swipe isn't a press on the card around it.
      const swallow = (c: Event) => {
        c.stopPropagation()
        c.preventDefault()
      }
      el.addEventListener("click", swallow, { capture: true, once: true })
      setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0)
    }
    el.addEventListener("pointerup", end)
    el.addEventListener("pointercancel", end)
    return { el, rec }
  },
}

// ---------- stack ----------

const PLACES: Record<string, [string, string]> = {
  // Physical: left and right don't flip in a right-to-left layout (widgets.md, Stack).
  "top-left": ["left", "start"],
  top: ["center", "start"],
  "top-right": ["right", "start"],
  left: ["left", "center"],
  center: ["center", "center"],
  right: ["right", "center"],
  "bottom-left": ["left", "end"],
  bottom: ["center", "end"],
  "bottom-right": ["right", "end"],
  fill: ["stretch", "stretch"],
}

/** A child's `inset` as CSS margins: a number for every side, or per side; logical px, at least 0. */
function inset(v: unknown): string {
  const side = (n: unknown) => `${Math.max(0, finite(n, 0))}px`
  if (typeof v === "number") return side(v)
  if (v && typeof v === "object") {
    const o = v as { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown }
    return `${side(o.top)} ${side(o.right)} ${side(o.bottom)} ${side(o.left)}`
  }
  return "0px"
}

/**
 * A `stack` (widgets.md, Stack): every child in one grid cell, the first at the bottom. A child's area is the cell minus
 * its `inset` (margins); `place` aligns its natural size in that area, or with `fill` stretches it (a canvas draws at
 * that size). Children let the pointer through to the layer below except where they take input (styles.ts).
 */
BUILDERS.stack = (ctx) => {
  const el = h(ctx, "div", "pw-stack")
  const rec: Rec = {
    type: "stack",
    node: { type: "stack" },
    update(n) {
      const kids = children(n).filter((c) => c && typeof c === "object" && KNOWN.has(c.type))
      // In full screen a stack with a canvas grows like one, unless all its canvases say `fill: false`.
      const grows = kids.some((c) => c.type === "canvas" && c.fill !== false)
      setClass(el, `pw-stack${grows ? " pw-fill pw-has-fill" : ""}`)
      reconcile(ctx, el, kids)
      kids.forEach((c, i) => {
        const child = el.children[i] as HTMLElement | undefined
        if (!child) return
        const place = typeof c.place === "string" && c.place in PLACES ? c.place : "top-left"
        const [x, y] = PLACES[place]!
        const surface = c.type === "canvas"
        // A canvas's natural width is its `width` or the area's.
        child.style.justifySelf = surface && place !== "fill" && !(finite(c.width, 0) > 0) ? "stretch" : x
        child.style.alignSelf = y
        child.style.margin = inset(c.inset)
        child.style.zIndex = String(i)
        // A `fill` canvas takes the area's height (its `height` stays the least, for the stack's own height).
        if (surface && place === "fill") child.style.height = "auto"
      })
    },
  }
  return { el, rec }
}

// ---------- surfaces: canvas (2D and GPU) ----------

/** A sized drawing surface that follows its width (and in full screen, unless `fill: false`, its share of the free height). */
abstract class SurfaceBase {
  readonly el: HTMLDivElement
  readonly canvas: HTMLCanvasElement
  node: ViewNode
  width = 0
  height = 0
  scale = 1
  readonly appeared = performance.now()
  pointer: { x: number; y: number; down: boolean } | null = null
  protected moved: PointerEvent | undefined
  private laid = ""
  protected observer: ResizeObserver
  protected destroyed = false
  protected ticking = false

  constructor(
    protected ctx: RenderContext,
    node: ViewNode,
  ) {
    this.node = node
    this.el = h(ctx, "div", "pw-surface")
    this.el.dataset.pwLive = ""
    this.el.dataset.kind = kind(node) === "canvas:gpu" ? "gpu" : kind(node) === "canvas:webgpu" ? "webgpu" : "2d"
    this.canvas = h(ctx, "canvas")
    this.el.append(this.canvas)
    this.observer = new ResizeObserver(() => this.measure())
    this.observer.observe(this.el)
    this.listen()
  }

  /** Point in the canvas, logical px. */
  private local(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  /** A `pointer` event for a canvas with `pointer: true` (2D or GPU alike). */
  private send(kind: "down" | "move" | "up", e: PointerEvent, down?: boolean) {
    const id = this.id
    // Only a canvas with `pointer: true` sends pointer events; any canvas keeps `frame.pointer` for its own visuals.
    if (id === null || this.node.pointer !== true || this.ctx.readOnly()) return
    const p = this.local(e)
    const value: Record<string, unknown> = { kind, x: p.x, y: p.y, width: this.width, height: this.height }
    // The close button's area, as the drawing saw it, for hit tests that keep clear of it.
    const close = this.close()
    if (close) value.close = close
    // Moves say whether a button is held: hover moves (desktop and web) have `down: false`.
    if (kind === "move") value.down = down ?? true
    this.ctx.emit({ id, type: "pointer", value })
  }

  /** Tracks the pointer for frames and uniforms; sends `down` and `up` at once, `move` only while down, at most once a frame. */
  private listen() {
    const c = this.canvas
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return
      c.setPointerCapture(e.pointerId)
      this.pointer = { ...this.local(e), down: true }
      this.send("down", e)
      this.pointerChanged()
    })
    c.addEventListener("pointermove", (e) => {
      const down = this.pointer?.down === true
      this.pointer = { ...this.local(e), down }
      // Drags, and on desktop and web hovers (touch has none): the latest of each frame is sent.
      if (down || e.pointerType !== "touch") this.moved = e
      this.pointerChanged(!down)
    })
    const up = (e: PointerEvent) => {
      if (this.pointer?.down !== true) return
      if (this.moved) {
        this.send("move", this.moved, true)
        this.moved = undefined
      }
      this.pointer = { ...this.local(e), down: false }
      this.send("up", e)
      this.pointerChanged()
    }
    c.addEventListener("pointerup", up)
    c.addEventListener("pointercancel", up)
    c.addEventListener("pointerleave", () => {
      if (this.pointer && !this.pointer.down) {
        this.pointer = null
        this.moved = undefined
        this.pointerChanged(true)
      }
    })
  }

  /** Sends the latest `move` of this frame, if any; each surface's tick calls it first. */
  protected flushMove() {
    const e = this.moved
    if (!e) return
    this.moved = undefined
    this.send("move", e, this.pointer?.down === true)
  }

  /** The pointer moved, went down or up (`hover`: only moved while up). */
  protected abstract pointerChanged(hover?: boolean): void

  built(): { el: HTMLElement; rec: Rec } {
    const rec: Rec = {
      type: kind(this.node),
      node: this.node,
      update: (n) => this.update(n),
      destroy: () => this.destroy(),
    }
    REC.set(this.el, rec)
    return { el: this.el, rec }
  }

  get id(): string | null {
    return typeof this.node.id === "string" ? this.node.id : null
  }

  /** Applies the node's size; returns whether the backing store changed. */
  protected layout(n: ViewNode): boolean {
    // Takes pointer input only with `pointer: true` (the prelude's mark for an `onPointer`); in a stack the rest lets
    // taps through. A canvas with only a `key` has an id for `widget.draw`, but takes no input.
    this.el.toggleAttribute("data-pointer", n.pointer === true)
    const height = Math.max(1, Math.min(4096, finite(n.height, 160)))
    const width = finite(n.width, 0)
    // Live programs re-render every frame: touch the DOM only when the size or label changes.
    const fill = n.fill !== false
    const key = `${height}|${width}|${fill}|${this.ctx.fullscreen()}|${str(n.alt)}`
    if (key === this.laid) return false
    this.laid = key
    this.el.style.minHeight = `${height}px`
    this.el.style.height = fill && this.ctx.fullscreen() ? "auto" : `${height}px`
    this.el.style.width = width > 0 ? `${width}px` : ""
    this.el.style.maxWidth = "100%"
    this.el.classList.toggle("pw-fill", fill)
    const alt = str(n.alt)
    if (alt) this.canvas.setAttribute("aria-label", alt)
    this.canvas.setAttribute("role", "img")
    return true
  }

  /** No width or height yet (laid out away, or changing size): never drawn or rendered then (widgets.md, Canvas). */
  zero = true

  protected measure(): boolean {
    if (this.destroyed) return false
    const rect = this.el.getBoundingClientRect()
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    const was = this.zero
    this.zero = width < 1 || height < 1
    if (this.zero) return false
    const scale = Math.min(3, globalThis.devicePixelRatio || 1)
    if (width === this.width && height === this.height && scale === this.scale) {
      // Sized again at its old size: draw what it skipped meanwhile.
      if (was) this.resized()
      return false
    }
    this.width = width
    this.height = height
    this.scale = scale
    ;[this.canvas.width, this.canvas.height] = this.backing(Math.round(width * scale), Math.round(height * scale))
    this.resized()
    return true
  }

  /** The canvas's backing size for its physical size. */
  protected backing(width: number, height: number): readonly [number, number] {
    return [width, height]
  }

  /** Measures now; whether the surface has a size to draw at. */
  sized(): boolean {
    this.measure()
    return !this.zero
  }

  frame(dt: number): Frame {
    // A surface rendered this frame hasn't had its ResizeObserver callback yet: measure now.
    this.measure()
    return {
      id: this.id,
      t: (performance.now() - this.appeared) / 1000,
      dt,
      width: this.width,
      height: this.height,
      scale: this.scale,
      pointer: this.pointer,
      dark: this.ctx.theme().dark,
      fullscreen: this.ctx.fullscreen(),
      close: this.close(),
    }
  }

  /** The full-screen close button's area in this surface's coordinates when it overlaps it, else null. */
  close(): Rect | null {
    const b = this.ctx.closeRect()
    if (!b) return null
    const c = this.canvas.getBoundingClientRect()
    if (b.right <= c.left || b.left >= c.right || b.bottom <= c.top || b.top >= c.bottom) return null
    return rectIn(b, c)
  }

  protected start() {
    if (this.ticking || this.destroyed) return
    this.ticking = true
    this.ctx.ticker.add(this.tick)
  }

  protected stop() {
    if (!this.ticking) return
    this.ticking = false
    this.ctx.ticker.delete(this.tick)
  }

  protected abstract tick: (now: number) => void
  protected abstract resized(): void
  abstract update(n: ViewNode): void

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.stop()
    this.observer.disconnect()
  }

  protected showAlt(text: string, error = false) {
    let alt = this.el.querySelector(".pw-alt") as HTMLElement | null
    if (!alt) {
      alt = h(this.ctx, "div", "pw-alt")
      this.el.append(alt)
    }
    alt.className = `pw-alt${error ? " pw-alt-error" : ""}`
    alt.textContent = text
  }
}

/** A `canvas` node: draw commands painted with Canvas2D. */
export class CanvasView extends SurfaceBase {
  private commands: Command[] | undefined
  private inflight = false
  private dirty = true
  private overruns = 0
  private frozen = false
  private lastFrame = 0
  private lastDrawT = -1
  private lastDrawAt = performance.now()
  private context: CanvasRenderingContext2D | null

  constructor(ctx: RenderContext, node: ViewNode) {
    super(ctx, node)
    this.context = this.canvas.getContext("2d", { alpha: true })
  }

  protected pointerChanged(hover?: boolean) {
    if (hover) {
      // Hovering changes `Frame.pointer` only: the next draw sees it.
      if (this.pointer === null || this.moved) this.start()
      return
    }
    if (this.moved) this.start()
    else this.invalidate()
  }

  update(n: ViewNode) {
    // `values` feed a shader: on a canvas without `wgsl` the view is invalid.
    if (n.values !== undefined) this.ctx.programError("view", { message: "a canvas has values but no wgsl" })
    this.node = n
    if (this.layout(n)) this.measure()
    // A new view may come with new state: draw again (step mode); live canvases repaint their latest commands.
    this.invalidate()
  }

  /** New commands from a live program's `draw`. */
  setCommands(commands: Command[]) {
    this.commands = commands
    this.repaint()
  }

  invalidate() {
    if (this.ctx.draw) {
      this.dirty = true
      this.frozen = this.frozen && this.overruns >= OVERRUNS_TO_FREEZE
      this.start()
    } else {
      this.commands = this.ctx.liveCommands(this.id) ?? this.commands
      this.repaint()
    }
  }

  protected resized() {
    // Resizing cleared the canvas: show the last commands at the new size until the next draw lands.
    this.repaint()
    if (this.ctx.draw) {
      this.dirty = true
      this.start()
    }
  }

  private fps(): number {
    return Math.min(MAX_FPS, Math.max(0, finite(this.node.fps, 0)))
  }

  /** Whether the draw step should run every frame now. */
  private animating(): boolean {
    if (this.frozen || this.fps() <= 0) return false
    const duration = finite(this.node.duration, -1)
    return duration < 0 || this.lastDrawT < duration
  }

  protected tick = (now: number) => {
    this.flushMove()
    const draw = this.ctx.draw
    if (!draw) return this.stop()
    if (!this.ctx.visible()) return this.stop()
    // Zero-sized: wait (the ResizeObserver brings it back with a size).
    if (this.zero) return this.stop()
    const animate = this.animating()
    const interval = animate ? 1000 / this.fps() - 2 : 0
    if (this.inflight) return
    if (!this.dirty && !animate) return this.moved ? undefined : this.stop()
    if (!this.dirty && now - this.lastFrame < interval) return
    this.dirty = false
    this.inflight = true
    this.lastFrame = now
    const at = performance.now()
    const frame = this.frame((at - this.lastDrawAt) / 1000)
    this.lastDrawAt = at
    void draw(frame).then((r) => {
      this.inflight = false
      if (this.destroyed) return
      if (r.error !== undefined || r.ms > DRAW_BUDGET_MS) {
        this.overruns++
        if (this.overruns >= OVERRUNS_TO_FREEZE && this.fps() > 0 && !this.frozen) {
          this.frozen = true
          // The 8 ms budget depends on the device: the host's, not a program error.
          this.ctx.clientError(`canvas ${this.id ?? ""} stopped animating: draw over budget ${OVERRUNS_TO_FREEZE} frames in a row`)
        }
      } else this.overruns = 0
      if (r.commands) {
        this.commands = r.commands
        this.lastDrawT = frame.t
        this.repaint()
      }
      if (this.animating() || this.dirty) this.start()
    })
  }

  /** Visible again: draw and animate as needed. */
  wake() {
    this.dirty = this.dirty || this.ctx.draw !== undefined
    if (this.ctx.draw) this.start()
  }

  repaint() {
    if (this.destroyed || this.zero || !this.context || !this.commands) return
    paint(this.context, this.commands, this.width, this.height, this.scale, this.ctx.theme(), this.ctx.images, () =>
      this.repaint(),
    )
  }
}

/** A GPU canvas (a `canvas` with `wgsl`): its WGSL on WebGPU; without it, its placeholder. */
export class GpuCanvasView extends SurfaceBase {
  private surface: Surface | undefined
  private wgsl: string | undefined
  private failed = false
  private slow = 0
  private stopped = false
  /** A GPU hang stopped it for the rest of the run: a new shader doesn't start it again. */
  private hung = false
  /** A GPU hang (widgets-gpu.md): a frame that hung stops it for good, whatever the 50 ms rule has counted. */
  private readonly hang = () => {
    if (this.destroyed || this.hung) return
    this.ctx.clientError(GPU_HANG)
    this.stopHung()
  }

  /** Stopped for the rest of the run by a GPU hang (its own, or its run's second strike): its placeholder with it. */
  stopHung() {
    if (this.destroyed || this.hung) return
    this.hung = this.stopped = true
    this.showError(GPU_HANG)
  }
  private uniforms = new Float32Array(UNIFORM_FLOATS)
  private values = ""
  private lastFrame = 0
  private dirty = true
  private poster: HTMLImageElement | undefined
  private builds = 0

  protected pointerChanged() {
    // `widget.pointer` follows the pointer; a GPU canvas at `fps: 0` renders again for it.
    this.dirty = true
    this.start()
  }

  /** Only `values` changed (live programs re-render every frame): new uniforms, no rebuild. */
  update(n: ViewNode) {
    this.node = n
    if (this.layout(n)) this.measure()
    const values = Array.isArray(n.values) ? n.values.slice(0, MAX_SHADER_VALUES).map((v) => finite(v, 0)) : []
    const key = values.join(",")
    if (key !== this.values) {
      this.values = key
      this.uniforms.fill(0, 8)
      this.uniforms.set(values, 8)
      this.dirty = true
    }
    const wgsl = str(n.wgsl)
    if (wgsl !== this.wgsl && !this.hung) {
      this.wgsl = wgsl
      this.failed = false
      this.stopped = false
      this.slow = 0
      this.surface?.destroy()
      this.surface = undefined
      void this.build(wgsl)
    }
    this.start()
  }

  private async build(wgsl: string) {
    if (new TextEncoder().encode(wgsl).length > MAX_SHADER_BYTES)
      return this.fail({ message: `the shader is over ${MAX_SHADER_BYTES / 1024} KB`, program: true })
    const made = await surface(this.canvas, wgsl)
    if (this.destroyed || wgsl !== this.wgsl) {
      if (!("message" in made)) made.destroy()
      return
    }
    if ("message" in made) return this.fail(made)
    this.surface = made
    // Its device lost: built again on a new one (the strike, if any, came first), unless it is stopped for good.
    void made.lost.then(() => {
      if (this.surface !== made || this.destroyed) return
      this.surface = undefined
      made.destroy()
      if (!this.hung && this.wgsl !== undefined) void this.build(this.wgsl)
    })
    this.el.dataset.backend = made.backend
    this.el.dataset.builds = String(++this.builds)
    this.dirty = true
    this.start()
  }

  private fail(e: ShaderError) {
    this.failed = true
    // Unavailable is not an error (widgets-gpu.md): `poster`, else `alt`, else "GPU canvas not supported".
    if (e.unavailable) {
      this.ctx.clientError(`shader: ${e.message}`, e)
      const poster = str(this.node.poster)
      const url = poster ? this.ctx.resolveImage(poster) : undefined
      if (url) {
        this.poster ??= h(this.ctx, "img", "pw-poster")
        this.poster.alt = str(this.node.alt)
        this.poster.src = url
        this.el.append(this.poster)
      } else this.showAlt(str(this.node.alt) || e.message)
      return
    }
    // Positions are in the node's WGSL, not the widget template's source: they go into the message.
    const message = e.line ? `${e.message} (WGSL line ${e.line}, column ${e.column})` : e.message
    if (e.program) this.ctx.programError("shader", { message })
    else this.ctx.clientError(`shader: ${message}`, e)
    this.showError(message)
  }

  /** `poster` or `alt`, with `message`. */
  private showError(message: string) {
    const poster = str(this.node.poster)
    const url = poster ? this.ctx.resolveImage(poster) : undefined
    if (url) {
      this.poster ??= h(this.ctx, "img", "pw-poster")
      this.poster.alt = str(this.node.alt)
      this.poster.src = url
      this.el.append(this.poster)
    }
    this.showAlt(url ? message : `${str(this.node.alt) ? str(this.node.alt) + "\n" : ""}${message}`, Boolean(url))
  }

  protected resized() {
    this.dirty = true
    this.start()
  }

  wake() {
    this.dirty = true
    this.start()
  }

  protected tick = (now: number) => {
    this.flushMove()
    if (this.failed || this.stopped || !this.ctx.visible() || this.zero) return this.stop()
    const s = this.surface
    // Never a frame while the last is drawing: this one waits for it (what it would draw is kept).
    if (!s || s.drawing) return
    // `fps` defaults to 60 for a GPU canvas; with `duration` it animates until then, and after only on new values.
    const duration = finite(this.node.duration, -1)
    const running = duration < 0 || (performance.now() - this.appeared) / 1000 < duration
    const fps = running ? Math.min(MAX_FPS, Math.max(0, finite(this.node.fps, 60))) : 0
    if (!this.dirty && fps <= 0) return this.stop()
    if (!this.dirty && now - this.lastFrame < 1000 / fps - 2) return
    this.dirty = false
    this.lastFrame = now
    const u = this.uniforms
    u[0] = this.canvas.width
    u[1] = this.canvas.height
    u[2] = (performance.now() - this.appeared) / 1000
    u[3] = this.scale
    const p = this.pointer
    u[4] = p ? p.x * this.scale : 0
    u[5] = p ? p.y * this.scale : 0
    u[6] = p?.down ? 1 : 0
    u[7] = 0
    // The run's strike, not the shader's: the shaders share a device, strikes are the run's (widgets-gpu.md, Strikes).
    const took = s.render(u, this.hang, this.ctx.gpuRun)
    void took?.then((ms) => {
      if (ms === undefined || this.stopped) return
      this.slow = ms > SHADER_FRAME_BUDGET_MS ? this.slow + 1 : 0
      if (this.slow >= OVERRUNS_TO_FREEZE && !this.stopped) {
        this.stopped = true
        // Its last frame stays.
        this.ctx.clientError(`the shader took over ${SHADER_FRAME_BUDGET_MS} ms a frame, three frames in a row`)
      }
    })
  }

  destroy() {
    super.destroy()
    this.surface?.destroy()
    this.surface = undefined
  }
}

/**
 * A GPU canvas (`gpu: true`, widgets-gpu.md): the widget's `GpuReplay` configures it and replays the program's WebGPU
 * calls into it; it sizes itself as every canvas does, and shows its placeholder when there is no GPU or it failed.
 */
export class WebGpuCanvasView extends SurfaceBase implements GpuCanvas {
  /** The physical size last sent to the program (`{ type: "canvas", key, width, height }`). */
  sent = ""
  private poster: HTMLImageElement | undefined

  constructor(ctx: RenderContext, node: ViewNode) {
    super(ctx, node)
    // No WebGPU (widgets-gpu.md): the placeholder, a client error; the program, told, posts no batches.
    if (!(navigator as Navigator & { gpu?: unknown }).gpu) {
      this.placeholder()
      ctx.clientError("GPU canvas: no WebGPU in this browser")
    }
  }

  update(n: ViewNode) {
    this.node = n
    if (this.layout(n)) this.measure()
  }

  /** Clamped to the texture limit, its aspect kept (widgets-gpu.md, Canvas size); the box scales it. */
  protected override backing(width: number, height: number) {
    return canvasSize(width, height)
  }

  /** What the placeholder shows, while it shows: `null` without a message. */
  private showing: string | null | undefined

  /** `poster`, else `alt`, else "GPU canvas not supported"; with a program error's message under it. */
  placeholder(message?: string) {
    if (this.showing === (message ?? null)) return
    this.showing = message ?? null
    const poster = str(this.node.poster)
    const url = poster ? this.ctx.resolveImage(poster) : undefined
    if (url) {
      this.poster ??= h(this.ctx, "img", "pw-poster")
      this.poster.alt = str(this.node.alt)
      this.poster.src = url
      this.el.append(this.poster)
      if (message) this.showAlt(message, true)
      else this.el.querySelector(".pw-alt")?.remove()
      return
    }
    const alt = str(this.node.alt) || "GPU canvas not supported"
    this.showAlt(message ? `${alt}\n${message}` : alt)
  }

  shown() {
    this.showing = undefined
    this.poster?.remove()
    this.el.querySelector(".pw-alt")?.remove()
  }

  wake() {}
  protected pointerChanged() {}
  protected resized() {}
  protected tick = () => this.stop()
}

/** `r` in the coordinates of `origin`'s top-left corner, rounded to logical pixels. */
export function rectIn(r: DOMRect, origin: DOMRect): Rect {
  return {
    x: Math.round(r.left - origin.left),
    y: Math.round(r.top - origin.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  }
}

/** The surfaces under `root`, in document order. */
export function surfaces(root: Element): (CanvasView | GpuCanvasView | WebGpuCanvasView)[] {
  const out: (CanvasView | GpuCanvasView | WebGpuCanvasView)[] = []
  for (const el of root.querySelectorAll(".pw-surface")) {
    const view = VIEWS.get(el)
    if (view) out.push(view)
  }
  return out
}

const VIEWS = new WeakMap<Element, CanvasView | GpuCanvasView | WebGpuCanvasView>()
const register = (v: CanvasView | GpuCanvasView | WebGpuCanvasView) => VIEWS.set(v.el, v)
BUILDERS.canvas = (ctx, node) => {
  const k = kind(node)
  const v = k === "canvas:gpu" ? new GpuCanvasView(ctx, node) : k === "canvas:webgpu" ? new WebGpuCanvasView(ctx, node) : new CanvasView(ctx, node)
  register(v)
  return v.built()
}
