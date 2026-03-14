import { MouseButton, RGBA, type MouseEvent, type OptimizedBuffer, type Renderable } from "@opentui/core"
import { Clipboard } from "./clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

type Renderer = {
  addPostProcessFn: (fn: (buffer: OptimizedBuffer, delta: number) => void) => void
  clearSelection: () => void
  currentRenderBuffer: OptimizedBuffer
  getSelection: () => { getSelectedText: () => string } | null
  requestRender: () => void
}

type Hit = Renderable & {
  height: number
  num: number
  selectable: boolean
  width: number
  x: number
  y: number
}

type Mark = {
  text: string
  x0: number
  x1: number
  y: number
}

type Cell = {
  end: number
  index: number
  start: number
  text: string
}

type Line = {
  chars: Cell[]
  cells: (Cell | undefined)[]
}

type State = {
  bg: RGBA
  fg: RGBA
  mark: Mark | null
}

const GAP = 350
const MASK = 3221225472 | 0
const CONT = 3221225472 | 0
const SPACE = /^\s$/
const store = new WeakMap<Renderer, State>()
const decode = new TextDecoder()

function state(renderer: Renderer) {
  const existing = store.get(renderer)
  if (existing) return existing

  const next: State = {
    bg: RGBA.fromInts(0, 120, 215),
    fg: RGBA.fromInts(0, 0, 0),
    mark: null,
  }

  renderer.addPostProcessFn((buffer) => {
    const mark = next.mark
    if (!mark) return
    if (mark.y < 0 || mark.y >= buffer.height) return

    const x0 = Math.max(0, Math.min(buffer.width, mark.x0))
    const x1 = Math.max(x0, Math.min(buffer.width, mark.x1))
    const bg = buffer.buffers.bg
    const fg = buffer.buffers.fg

    for (let x = x0; x < x1; x++) {
      const i = (mark.y * buffer.width + x) * 4
      bg[i] = next.bg.r
      bg[i + 1] = next.bg.g
      bg[i + 2] = next.bg.b
      bg[i + 3] = next.bg.a
      fg[i] = next.fg.r
      fg[i + 1] = next.fg.g
      fg[i + 2] = next.fg.b
      fg[i + 3] = next.fg.a
    }
  })

  store.set(renderer, next)
  return next
}

function text(renderer: Renderer) {
  return state(renderer).mark?.text ?? renderer.getSelection()?.getSelectedText() ?? ""
}

function pick(input: Renderable | null | undefined) {
  let item = input
  while (item) {
    if (item.selectable && item.width > 0 && item.height > 0) return item as Hit
    item = item.parent
  }
}

function row(item: Hit, y: number) {
  return y >= item.y && y < item.y + item.height
}

function line(renderer: Renderer, y: number) {
  const buffer = renderer.currentRenderBuffer
  if (y < 0 || y >= buffer.height) return

  const text = Array.from(decode.decode(buffer.getRealCharBytes(true)).split("\n")[y] ?? "")
  const raw = buffer.buffers.char
  const cells = [] as (Cell | undefined)[]
  const chars = [] as Cell[]
  let cursor = 0

  for (let x = 0; x < buffer.width; x++) {
    const char = raw[y * buffer.width + x]
    if ((char & MASK) === CONT) continue

    let end = x + 1
    while (end < buffer.width && (raw[y * buffer.width + end] & MASK) === CONT) end += 1

    const next = {
      end,
      index: chars.length,
      start: x,
      text: text[cursor++] ?? " ",
    }

    chars.push(next)
    for (let i = x; i < end; i++) cells[i] = next
    x = end - 1
  }

  return {
    chars,
    cells,
  } satisfies Line
}

function range(item: Hit, y: number) {
  const parent = item.parent
  if (!parent) {
    return {
      x0: item.x,
      x1: item.x + item.width,
    }
  }

  const list = parent
    .getChildren()
    .filter((child): child is Hit => child.selectable && child.width > 0 && child.height > 0 && row(child, y))
    .sort((a, b) => a.x - b.x)
  const hit = list.some((child) => child.num === item.num)
  if (!hit || !list.length) {
    return {
      x0: item.x,
      x1: item.x + item.width,
    }
  }

  return {
    x0: Math.min(...list.map((child) => child.x)),
    x1: Math.max(...list.map((child) => child.x + child.width)),
  }
}

function set(renderer: Renderer, x0: number, x1: number, y: number, line: Line) {
  const text = line.chars
    .filter((char) => char.end > x0 && char.start < x1)
    .map((char) => char.text)
    .join("")
    .replace(/\s+$/, "")
  if (!text) {
    clear(renderer)
    return ""
  }

  const value = state(renderer)
  renderer.clearSelection()
  value.mark = {
    x0,
    x1,
    y,
    text,
  }
  renderer.requestRender()
  return text
}

function word(renderer: Renderer, item: Hit, x: number, y: number) {
  const current = line(renderer, y)
  if (!current) return ""

  const { x0, x1 } = range(item, y)
  if (x < x0 || x >= x1) return ""
  const cell = current.cells[x]
  if (!cell || SPACE.test(cell.text)) {
    clear(renderer)
    return ""
  }

  let start = cell.index
  while (start > 0 && current.chars[start - 1] && current.chars[start - 1].end > x0 && !SPACE.test(current.chars[start - 1].text)) {
    start -= 1
  }

  let end = cell.index + 1
  while (end < current.chars.length && current.chars[end] && current.chars[end].start < x1 && !SPACE.test(current.chars[end].text)) {
    end += 1
  }

  return set(renderer, current.chars[start].start, current.chars[end - 1].end, y, current)
}

function full(renderer: Renderer, item: Hit, x: number, y: number) {
  const current = line(renderer, y)
  if (!current) return ""

  const { x0, x1 } = range(item, y)
  if (x < x0 || x >= x1) return ""
  const hit = current.cells[x]
  if (!hit || SPACE.test(hit.text)) {
    clear(renderer)
    return ""
  }

  const chars = current.chars.filter((char) => char.end > x0 && char.start < x1)
  if (!chars.length) {
    clear(renderer)
    return ""
  }
  return set(renderer, chars[0].start, chars[chars.length - 1].end, y, current)
}

function clear(renderer: Renderer) {
  const value = state(renderer)
  if (!value.mark) return
  value.mark = null
  renderer.requestRender()
}

function reset(input: Selection.Click) {
  input.count = 0
  input.item = -1
  input.mode = null
  input.row = -1
  input.time = 0
  input.x = -1
}

export namespace Selection {
  export type Click = {
    count: number
    item: number
    mode: "line" | "word" | null
    row: number
    time: number
    x: number
  }

  export function click(): Click {
    return {
      count: 0,
      item: -1,
      mode: null,
      row: -1,
      time: 0,
      x: -1,
    }
  }

  export function configure(renderer: Renderer, input: { bg: RGBA; fg: RGBA }) {
    const value = state(renderer)
    value.bg = input.bg
    value.fg = input.fg
    renderer.requestRender()
  }

  export function active(renderer: Renderer) {
    return !!text(renderer)
  }

  export function dismiss(renderer: Renderer) {
    clear(renderer)
  }

  export function press(input: Click, renderer: Renderer, evt: MouseEvent) {
    if (evt.button !== MouseButton.LEFT) {
      reset(input)
      return false
    }

    const item = pick(evt.target)
    if (!item || !row(item, evt.y)) {
      clear(renderer)
      reset(input)
      return false
    }

    const now = Date.now()
    const same = input.item === item.num && input.row === evt.y && Math.abs(input.x - evt.x) <= 1 && now - input.time <= GAP
    if (!same) clear(renderer)

    input.count = same ? input.count + 1 : 1
    input.item = item.num
    input.mode = null
    input.row = evt.y
    input.time = now
    input.x = evt.x

    if (input.count === 2) {
      if (!word(renderer, item, evt.x, evt.y)) return false
      input.mode = "word"
      evt.preventDefault()
      evt.stopPropagation()
      return true
    }

    if (input.count < 3) return false
    if (!full(renderer, item, evt.x, evt.y)) {
      reset(input)
      return false
    }

    input.count = 0
    input.mode = "line"
    evt.preventDefault()
    evt.stopPropagation()
    return true
  }

  export function release(input: Click, renderer: Renderer, toast: Toast, evt: MouseEvent) {
    if (evt.button !== MouseButton.LEFT) return false
    if (!input.mode) return false

    input.mode = null
    if (!copy(renderer, toast, { clear: false })) return false
    evt.preventDefault()
    evt.stopPropagation()
    return true
  }

  export function copy(renderer: Renderer, toast: Toast, opts?: { clear?: boolean }): boolean {
    const value = text(renderer)
    if (!value) return false

    Clipboard.copy(value)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    if (opts?.clear !== false) {
      clear(renderer)
      renderer.clearSelection()
    }
    return true
  }
}
