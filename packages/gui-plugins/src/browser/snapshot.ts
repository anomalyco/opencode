import type { Protocol } from "devtools-protocol"
import { Browser } from "@opencode/plugin-browser/rpc"

/** Shape one frame's AX tree. Frame documents have their own target checks and are requested by frameID. */
export async function accessibilitySnapshot(
  nodes: readonly Protocol.Accessibility.AXNode[],
  options: {
    root?: number
    depth?: number
    text?: string
    interactive?: boolean
    maxLines?: number
    previous: ReadonlyMap<number, string>
    picked: ReadonlyMap<number, string>
    ref: () => string
    box?: (id: number) => Promise<string>
  },
) {
  const root = options.root === undefined ? nodes[0] : nodes.find((node) => node.backendDOMNodeId === options.root)

  if (!root)
    throw new Error("Element is absent from this frame's accessibility snapshot. Refresh the snapshot without ref.")

  const index = new Map(nodes.map((node) => [node.nodeId, node]))
  const pending = [{ node: root, level: 0, scope: "", item: "", ordinal: 1, parent: "" }]
  const headings = new Map<string, string>()
  const seen = new Set<string>()
  const refs = new Map<string, number>()
  const lines: string[] = []
  const query = options.text?.toLowerCase()
  let size = 0
  let truncated = false

  while (pending.length) {
    const current = pending.pop()!
    const { node, level } = current

    if (seen.has(node.nodeId)) continue
    seen.add(node.nodeId)

    const role = String(node.role?.value ?? "node")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 40)

    const name = String(node.name?.value ?? "").replace(/\s+/g, " ")
    const id = node.backendDOMNodeId
    const picked = id && options.picked.get(id)
    const props = new Map(node.properties?.map((p) => [p.name, p.value.value]))
    const editable = role === "textbox" || role === "searchbox" || props.get("editable")

    const actionable =
      role !== "RootWebArea" &&
      (props.get("focusable") ||
        editable || /^(button|link|textbox|searchbox|combobox|listbox|checkbox|radio|option|switch|tab|menuitem|menuitemcheckbox|menuitemradio|slider|spinbutton|treeitem|scrollbar)$/.test(
          role,
        ))

    const children = node.childIds ?? []

    const wrapper =
      role === "generic" &&
      !name &&
      !actionable &&
      !editable &&
      !picked &&
      !node.value &&
      !node.description &&
      !props.size &&
      children.length === 1

    const visible = !node.ignored && !wrapper && role !== "InlineTextBox"
    const lean = options.interactive === true
    const contextual = lean && visible
    const landmark = contextual && name && /^(banner|navigation|main|region|form|search|complementary|dialog|table|grid|list|group|heading)$/.test(role)
    const inherited = headings.get(current.parent) ?? current.scope
    const scope = landmark ? `${role} ${brief(name)}` : inherited
    if (contextual && role === "heading" && name) headings.set(current.parent, scope)
    const itemName = contextual && role === "row" && !name ? String(index.get(children[0])?.name?.value ?? "").replace(/\s+/g, " ") : name
    const item = contextual && (role === "row" || role === "listitem")
      ? `${role} ${itemName ? brief(itemName) : current.ordinal}` : current.item

    if (visible && level > (options.depth ?? Infinity)) {
      truncated = true
      continue
    }

    if (visible && (!lean || (actionable && id))) {
      const flags = (["checked", "disabled", "expanded", "selected", "pressed"] as const).flatMap((key) =>
        props.has(key) ? [`${key}=${props.get(key)}`] : [],
      )

      const context = lean ? [inherited, current.item].filter(Boolean).join(" / ") : ""
      const label = `[${role}] ${lean ? brief(name) : JSON.stringify(name.length > 300 ? `${name.slice(0, 299)}…` : name)}${flags.length ? ` ${flags.join(" ")}` : ""}${context ? ` in ${context}` : ""}`
      const known = picked || (id && options.previous.get(id))

      if (
        !query ||
        label.toLowerCase().includes(query) ||
        name.toLowerCase().includes(query) ||
        (known && `@${known}`.includes(query))
      ) {
        if (lines.length >= (options.maxLines ?? Infinity)) {
          truncated = true
          break
        }
        const ref = id && (picked || actionable) ? known || options.ref() : undefined
        const box = ref && id && options.box ? await options.box(id) : ""
        const line = `${lean ? "" : "  ".repeat(Math.min(level, 16))}${ref ? `@${ref} ` : ""}${label}${box}`
        size += line.length + Number(lines.length > 0)

        if (size > Browser.MAX_TEXT) {
          truncated = true
          break
        }

        lines.push(line)

        if (id && ref) refs.set(ref, id)
      }
    }

    // Editable descendants may contain a field's private value; do not inspect them, even for a search.
    if (editable) continue

    for (let i = children.length - 1; i >= 0; i--) {
      const child = index.get(children[i])

      if (child) pending.push({ node: child, level: level + Number(visible), scope, item, ordinal: i + 1, parent: node.nodeId })
    }
  }

  return { content: lines.join("\n"), truncated, refs }
}

function brief(value: string) {
  return JSON.stringify(value.length > 60 ? `${value.slice(0, 59)}…` : value)
}
