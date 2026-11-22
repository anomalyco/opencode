import { Host } from "psychoscript"

// Native tree building (specs/v2/widgets.md, Native hosts): what the prelude's `__widget_tree` makes, from a view as the
// program built it, which crossed under `translate: { functions: "mark" }` with `Host.functionMarker` where each
// function was.

const CONTROLS: Record<string, { readonly handler: string; readonly always?: boolean; readonly keyed?: boolean }> = {
  button: { handler: "onPress", always: true },
  card: { handler: "onPress" },
  checkbox: { handler: "onChange", always: true },
  slider: { handler: "onChange", always: true },
  select: { handler: "onChange", always: true },
  input: { handler: "onChange", always: true },
  carousel: { handler: "onChange" },
  canvas: { handler: "onPointer", keyed: true },
}

const REMOVED = new Set(["key", "id", "pointer", "onPress", "onChange", "onPointer", "children"])

export const marker: unknown = Host.functionMarker

/** The tree clients get, the ids that have handlers, and its canvases' ids by key. */
export interface Tree {
  readonly view: unknown
  readonly handlers: ReadonlySet<string>
  readonly canvases: ReadonlyMap<string, { readonly id: string; readonly wgsl: boolean }>
}

type Item = Record<string, unknown>

const isNode = (value: unknown): value is Item => typeof value === "object" && value !== null && !Array.isArray(value)
const named = (node: Item) => node.key !== undefined && node.key !== null
const segment = (node: Item) => ":" + encodeURIComponent(String(node.key))
const omitted = Symbol("omitted")

/**
 * A function a live post may not carry: the error the interpreter throws for one without `"mark"`, so a program sees
 * the same as when the prelude built the tree. `label` names the argument, as in `Argument 1 to __host.post`.
 */
export const carried = (label: string) =>
  new TypeError(`${label} contains a function, which cannot be passed to the host.`)

/**
 * `value` with its markers gone, as a step output leaves out functions: left out of objects, `null` in arrays. With
 * `strict` (a live post) a marker throws instead, as a function in a post does. Copies only what changes.
 */
export function unmark(value: unknown, strict?: string): unknown {
  const out = clean(value, strict)
  return out === omitted ? undefined : out
}

function clean(value: unknown, strict: string | undefined): unknown {
  if (value === marker) {
    if (strict !== undefined) throw carried(strict)
    return omitted
  }
  if (typeof value !== "object" || value === null) return value
  if (Array.isArray(value)) {
    let out: unknown[] | undefined
    for (let index = 0; index < value.length; index++) {
      const item = clean(value[index], strict)
      if (item === value[index]) continue
      out ??= value.slice()
      out[index] = item === omitted ? null : item
    }
    return out ?? value
  }
  let out: Item | undefined
  for (const name in value) {
    const prop = (value as Item)[name]
    const item = clean(prop, strict)
    if (item === prop) continue
    out ??= { ...(value as Item) }
    if (item === omitted) delete out[name]
    else out[name] = item
  }
  return out ?? value
}

/** Builds the tree clients get from `root`; `strict` as for `unmark`, for a live render. */
export function tree(root: unknown, strict?: string): Tree {
  const canvases = new Map<string, { id: string; wgsl: boolean }>()
  const handlers = new Set<string>()

  const node = (value: Item, path: string): Item => {
    const out: Item = {}
    for (const name in value) {
      if (REMOVED.has(name)) continue
      const item = clean(value[name], strict)
      if (item !== omitted) out[name] = item
    }
    const control =
      typeof value.type === "string" && Object.hasOwn(CONTROLS, value.type) ? CONTROLS[value.type] : undefined
    if (control) {
      const handled = value[control.handler] === marker
      const keyed = control.keyed === true && named(value)
      if (handled || control.always || keyed) {
        out.id = path
        if (handled) handlers.add(path)
        if (value.type === "canvas" && handled) out.pointer = true
        if (keyed && !canvases.has(String(value.key)))
          canvases.set(String(value.key), { id: path, wgsl: typeof value.wgsl === "string" })
      }
    }
    if (value.children === undefined) return out
    const children: unknown[] = []
    const seen = new Map<string, number>()
    const flatten = (list: ReadonlyArray<unknown>, prefix: string) => {
      for (let index = 0; index < list.length; index++) {
        const child = list[index]
        if (!child) continue
        if (Array.isArray(child)) flatten(child, prefix + index + ".")
        else if (!isNode(child)) {
          const item = clean(child, strict)
          children.push(item === omitted ? null : item)
        } else if (!named(child)) children.push(node(child, path + "/" + prefix + index))
        else {
          const count = (seen.get(segment(child)) ?? 0) + 1
          seen.set(segment(child), count)
          children.push(node(child, path + "/" + segment(child) + (count > 1 ? "~" + count : "")))
        }
      }
    }
    flatten(Array.isArray(value.children) ? value.children : [value.children], "")
    out.children = children
    return out
  }

  const view = isNode(root) ? node(root, named(root) ? segment(root) : "0") : unmark(root, strict)
  return { view, handlers, canvases }
}
