// The tree building a native host does (specs/v2/widgets.md, Native hosts), in TypeScript: from a view as the program
// built it, with each function replaced by a marker (`isFunction`), to the tree clients get, the handler ids with their
// events and the canvas ids by key. The conformance tests hold it to the wire fixtures, as Rust hosts hold theirs.
const CONTROLS: Record<string, { event: string; handler: string; always?: boolean; keyed?: boolean }> = {
  button: { event: "press", handler: "onPress", always: true },
  card: { event: "press", handler: "onPress" },
  checkbox: { event: "change", handler: "onChange", always: true },
  slider: { event: "change", handler: "onChange", always: true },
  select: { event: "change", handler: "onChange", always: true },
  input: { event: "change", handler: "onChange", always: true },
  carousel: { event: "change", handler: "onChange" },
  canvas: { event: "pointer", handler: "onPointer", keyed: true },
}

const REMOVED = new Set(["key", "id", "pointer", "onPress", "onChange", "onPointer", "children"])

export interface NativeTree {
  readonly view: unknown
  readonly handlers: Record<string, string>
  readonly canvases: Record<string, { readonly id: string; readonly wgsl: boolean }>
}

type Item = Record<string, unknown>

const isNode = (value: unknown): value is Item => typeof value === "object" && value !== null && !Array.isArray(value)
const named = (node: Item) => node.key !== undefined && node.key !== null
const segment = (node: Item) => ":" + encodeURIComponent(String(node.key))

export const nativeTree = (root: unknown, isFunction: (value: unknown) => boolean): NativeTree => {
  const handlers: Record<string, string> = {}
  const canvases: Record<string, { id: string; wgsl: boolean }> = {}

  const node = (value: unknown, path: string): unknown => {
    if (!isNode(value)) return value
    const out: Item = {}
    for (const [name, prop] of Object.entries(value)) if (!REMOVED.has(name)) out[name] = prop
    const control =
      typeof value.type === "string" && Object.hasOwn(CONTROLS, value.type) ? CONTROLS[value.type] : undefined
    if (control) {
      const handled = isFunction(value[control.handler])
      const keyed = control.keyed === true && named(value)
      if (handled || control.always || keyed) {
        out.id = path
        if (handled) handlers[path] = control.event
        if (value.type === "canvas" && handled) out.pointer = true
        if (keyed && canvases[String(value.key)] === undefined)
          canvases[String(value.key)] = { id: path, wgsl: typeof value.wgsl === "string" }
      }
    }
    if (value.children === undefined) return out
    const children: unknown[] = []
    const seen = new Map<string, number>()
    const collect = (list: ReadonlyArray<unknown>, prefix: string) =>
      // A plain loop: `forEach` would skip holes, which must keep their index.
      Array.from({ length: list.length }, (_, index) => index).forEach((index) => {
        const child = list[index]
        if (!child) return
        if (Array.isArray(child)) return collect(child, prefix + index + ".")
        if (!isNode(child)) return void children.push(child)
        if (!named(child)) return void children.push(node(child, path + "/" + prefix + index))
        const count = (seen.get(segment(child)) ?? 0) + 1
        seen.set(segment(child), count)
        children.push(node(child, path + "/" + segment(child) + (count > 1 ? "~" + count : "")))
      })
    collect(Array.isArray(value.children) ? value.children : [value.children], "")
    out.children = children
    return out
  }

  const view = node(root, isNode(root) && named(root) ? segment(root) : "0")
  return { view, handlers, canvases }
}
