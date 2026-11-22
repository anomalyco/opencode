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

const HANDLERS = new Set(["onPress", "onChange", "onPointer"])

/** The most levels a view nests (specs/v2/widgets.md, Keys and depth), and the failures of a view that breaks the rules. */
export const LEVELS = 100
export const DEEP = "The view nests more than 100 levels"
export const KEY = "A node's key must be a string, a number or a boolean"

/** A view that breaks a rule of views: a program error in phase `view`. */
export class ViewError extends Error {}

export const marker: unknown = Host.functionMarker

/** The tree clients get, the ids that have handlers, and its canvases' ids by key. */
export interface Tree {
  readonly view: unknown
  readonly handlers: ReadonlySet<string>
  readonly canvases: ReadonlyMap<string, { readonly id: string; readonly wgsl: boolean; readonly gpu: boolean }>
}

type Item = Record<string, unknown>

const isNode = (value: unknown): value is Item => typeof value === "object" && value !== null && !Array.isArray(value)
const named = (node: Item) => {
  const key = node.key
  if (key === undefined || key === null) return false
  if (typeof key === "string" || typeof key === "number" || typeof key === "boolean") return true
  throw new ViewError(KEY)
}
const segment = (node: Item) => ":" + encodeURIComponent(String(node.key))
const omitted = Symbol("omitted")

/**
 * A function where a host call's argument may not carry one: the error the interpreter throws for one without `"mark"`.
 * `label` names the argument, as in `Argument 1 to __host.post`.
 */
export const carried = (label: string) =>
  new TypeError(`${label} contains a function, which cannot be passed to the host.`)

/** `value` as JSON holds it: without markers, `undefined` left out (`null` in an array), non-finite numbers `null`. */
export function json(value: unknown): unknown {
  const out = clean(value, undefined, true)
  return out === omitted ? undefined : out
}

/**
 * `value` with its markers gone, as a run's result leaves out functions: left out of objects, `null` in arrays. With
 * `strict` (a host call's argument) a marker throws instead. Copies only what changes.
 */
export function unmark(value: unknown, strict?: string): unknown {
  const out = clean(value, strict)
  return out === omitted ? undefined : out
}

// `value` without markers. With `json` (a view), also as JSON holds it: `undefined` left out (`null` in an array), a
// non-finite number `null`.
function clean(value: unknown, strict: string | undefined, json = false): unknown {
  if (value === marker) {
    if (strict !== undefined) throw carried(strict)
    return omitted
  }
  if (json && value === undefined) return omitted
  if (json && typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "object" || value === null) return value
  if (Array.isArray(value)) {
    let out: unknown[] | undefined
    for (let index = 0; index < value.length; index++) {
      const item = clean(value[index], strict, json)
      if (item === value[index]) continue
      out ??= value.slice()
      out[index] = item === omitted ? null : item
    }
    return out ?? value
  }
  let out: Item | undefined
  for (const name in value) {
    const prop = (value as Item)[name]
    const item = clean(prop, strict, json)
    if (item === prop) continue
    out ??= { ...(value as Item) }
    if (item === omitted) delete out[name]
    else out[name] = item
  }
  return out ?? value
}

/**
 * Builds the tree clients get from `root`, the view as built in a host call's argument named `label`. Throws a
 * `ViewError` for a key of another type or a view deeper than `LEVELS`, and `carried(label)` for a function anywhere
 * but a node's handler props.
 */
export function tree(root: unknown, label: string): Tree {
  const canvases = new Map<string, { id: string; wgsl: boolean; gpu: boolean }>()
  const handlers = new Set<string>()

  const node = (value: Item, path: string, level: number): Item => {
    const keyed = named(value)
    const out: Item = {}
    for (const name in value) {
      if (name === "children" || HANDLERS.has(name)) continue
      const item = clean(value[name], label, true)
      if (item !== omitted && name !== "key" && name !== "id" && name !== "pointer") out[name] = item
    }
    const control =
      typeof value.type === "string" && Object.hasOwn(CONTROLS, value.type) ? CONTROLS[value.type] : undefined
    if (control) {
      const handled = value[control.handler] === marker
      const canvas = control.keyed === true && keyed
      if (handled || control.always || canvas) {
        out.id = path
        if (handled) handlers.add(path)
        if (value.type === "canvas" && handled) out.pointer = true
        if (canvas && !canvases.has(String(value.key)))
          canvases.set(String(value.key), { id: path, wgsl: typeof value.wgsl === "string", gpu: value.gpu === true })
      }
    }
    if (value.children === undefined) return out
    const children: unknown[] = []
    const seen = new Map<string, number>()
    const flatten = (list: ReadonlyArray<unknown>, prefix: string, level: number) => {
      for (let index = 0; index < list.length; index++) {
        const child = list[index]
        if (!child) continue
        if (level > LEVELS && typeof child === "object") throw new ViewError(DEEP)
        if (Array.isArray(child)) flatten(child, prefix + index + ".", level + 1)
        else if (!isNode(child)) children.push(clean(child, label, true))
        else if (!named(child)) children.push(node(child, path + "/" + prefix + index, level))
        else {
          const count = (seen.get(segment(child)) ?? 0) + 1
          seen.set(segment(child), count)
          children.push(node(child, path + "/" + segment(child) + (count > 1 ? "~" + count : ""), level))
        }
      }
    }
    flatten(Array.isArray(value.children) ? value.children : [value.children], "", level + 1)
    out.children = children
    return out
  }

  if (isNode(root)) return { view: node(root, named(root) ? segment(root) : "0", 1), handlers, canvases }
  const view = clean(root, label, true)
  return { view: view === omitted ? undefined : view, handlers, canvases }
}
