import type { Protocol } from "devtools-protocol"
import { Browser } from "@opencode/plugin-browser/rpc"

/** Shape one frame's AX tree. Frame documents have their own target checks and are requested by frameID. */
export async function accessibilitySnapshot(
  nodes: readonly Protocol.Accessibility.AXNode[],
  options: {
    root?: number
    depth?: number
    text?: string
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
  const pending = [{ node: root, level: 0 }]
  const seen = new Set<string>()
  const refs = new Map<string, number>()
  const lines: string[] = []
  const query = options.text?.toLowerCase()
  let size = 0
  let truncated = false

  while (pending.length) {
    const { node, level } = pending.pop()!

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
        /^(button|link|textbox|combobox|checkbox|radio|option|switch|tab|menuitem|menuitemcheckbox|menuitemradio|slider|spinbutton|treeitem)$/.test(
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

    if (visible && level > (options.depth ?? Infinity)) {
      truncated = true
      continue
    }

    if (visible) {
      const flags = (["checked", "disabled", "expanded", "selected"] as const).flatMap((key) =>
        props.has(key) ? [`${key}=${props.get(key)}`] : [],
      )

      const label = `[${role}] ${JSON.stringify(name.length > 300 ? `${name.slice(0, 299)}…` : name)}${flags.length ? ` ${flags.join(" ")}` : ""}`
      const known = picked || (id && options.previous.get(id))

      if (
        !query ||
        label.toLowerCase().includes(query) ||
        name.toLowerCase().includes(query) ||
        (known && `@${known}`.includes(query))
      ) {
        const ref = id && (picked || actionable) ? known || options.ref() : undefined
        const box = ref && id && options.box ? await options.box(id) : ""
        const line = `${"  ".repeat(Math.min(level, 16))}${ref ? `@${ref} ` : ""}${label}${box}`
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

      if (child) pending.push({ node: child, level: level + Number(visible) })
    }
  }

  return { content: lines.join("\n"), truncated, refs }
}
