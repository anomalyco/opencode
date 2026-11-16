import type { Protocol } from "devtools-protocol"
import { setImmediate } from "node:timers/promises"

type Options = {
  root?: number
  depth?: number
  text?: string
  interactive?: boolean
  maxLines?: number
  maxChars?: number
  previous: ReadonlyMap<number, string>
  picked: ReadonlyMap<number, string>
  ref: () => string
  box?: (id: number) => Promise<string>
  signal?: AbortSignal
}

type Area = { id: number; role: string; count: number; skipped: number }

type Overflow = { area: Area; keep: boolean; parent?: Overflow }

type Branch = {
  node: Protocol.Accessibility.AXNode
  level: number
  parent: string
  parentName: string
  scope: string
  item: string
  ordinal: number
  priority?: number
  area?: Area
  collection?: Area
  overflow?: Overflow
}

type Line = { label: string; id?: number; interactive: boolean; area?: Area; overflow?: Overflow; deep: boolean }

const controls =
  /^(button|link|textbox|searchbox|combobox|listbox|checkbox|radio|option|switch|tab|menuitem|menuitemcheckbox|menuitemradio|slider|spinbutton|treeitem|scrollbar)$/

const collections = /^(table|grid|treegrid|list|listbox|combobox|menu|tree)$/

const landmarks = /^(dialog|alertdialog|main|form|search|region|navigation|contentinfo|banner|complementary)$/

function excerpt(name: string, limit: number) {
  return name.length <= limit ? name : `${name.slice(0, limit)}… [+${name.length - limit} chars]`
}

function rank(role: string) {
  if (role === "alertdialog" || role === "dialog") return 1

  if (role === "main") return 2

  if (role === "form" || role === "search") return 3

  if (landmarks.test(role)) return 4
}

/** One frame per walk. Never inspect editable descendants, even to count omitted nodes or search text. */
export async function accessibilitySnapshot(nodes: readonly Protocol.Accessibility.AXNode[], options: Options) {
  const index = new Map<string, Protocol.Accessibility.AXNode>()
  let root = options.root === undefined ? nodes[0] : undefined

  for (const node of nodes) {
    index.set(node.nodeId, node)

    if (options.root !== undefined && node.backendDOMNodeId === options.root && (!root || root.ignored)) root = node

    if (index.size % 2048 === 0) await setImmediate(undefined, { signal: options.signal })
  }

  if (!root)
    throw new Error("Element is absent from this frame's accessibility snapshot. Refresh the snapshot without ref.")
  const pending: Branch[] = [{ node: root, level: 0, parent: "", parentName: "", scope: "", item: "", ordinal: 1 }]
  const buckets = Array.from({ length: 6 }, (): Line[] => [])
  const seen = new Set<string>()
  const headings = new Map<string, string>()
  const overflowItems: Overflow[] = []
  const query = options.text?.toLowerCase()

  while (pending.length) {
    const branch = pending.pop()

    if (!branch || seen.has(branch.node.nodeId)) continue
    const node = branch.node
    seen.add(node.nodeId)

    if (seen.size % 2048 === 0) await setImmediate(undefined, { signal: options.signal })

    const role = String(node.role?.value ?? "node")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 40)

    const name = String(node.name?.value ?? "").replace(/\s+/g, " ")
    const id = node.backendDOMNodeId
    const picked = id && options.picked.get(id)
    const known = picked || (id && options.previous.get(id))
    const props = new Map(node.properties?.map((p) => [p.name, p.value.value]))
    const editable = role === "textbox" || role === "searchbox" || !!props.get("editable")
    const interactive = !!id && role !== "RootWebArea" && (editable || !!props.get("focusable") || controls.test(role))

    const wrapper =
      /^(generic|none|presentation)$/.test(role) &&
      !name &&
      !interactive &&
      !known &&
      !node.value &&
      !node.description &&
      !props.size

    const visible =
      !node.ignored &&
      !wrapper &&
      role !== "InlineTextBox" &&
      !(role === "StaticText" && name === branch.parentName && !known)

    const area =
      visible && id && (landmarks.test(role) || collections.test(role))
        ? { id, role, count: 0, skipped: 0 }
        : branch.area

    const collection = area && collections.test(area.role) ? area : branch.collection
    const priority = branch.priority ?? (visible ? rank(role) : undefined)
    const inherited = headings.get(branch.parent) ?? branch.scope

    const scope =
      options.interactive && visible && name && (landmarks.test(role) || collections.test(role) || role === "heading")
        ? `${role} ${JSON.stringify(excerpt(name, 60))}`
        : inherited

    if (options.interactive && visible && role === "heading" && name) headings.set(branch.parent, scope)
    const children = node.childIds ?? []
    const isItem = visible && /^(row|listitem|option)$/.test(role)

    const itemName =
      options.interactive && role === "row" && !name
        ? String(index.get(children[0])?.name?.value ?? "").replace(/\s+/g, " ")
        : name

    const item =
      options.interactive && isItem
        ? `${role} ${itemName ? JSON.stringify(excerpt(itemName, 60)) : branch.ordinal}`
        : branch.item

    const overflow =
      isItem && collection && options.text === undefined && collection.id !== options.root && ++collection.count > 25
        ? { area: collection, keep: false, parent: branch.overflow }
        : branch.overflow

    if (overflow && overflow !== branch.overflow) overflowItems.push(overflow)

    if (
      overflow &&
      ["focused", "selected", "checked"].some((key) =>
        node.properties?.some((p) => p.name === key && [true, "true", "mixed"].includes(p.value.value)),
      )
    ) {
      for (let group: Overflow | undefined = overflow; group; group = group.parent) group.keep = true
    }

    if (visible && (!options.interactive || interactive)) {
      const flags = (["checked", "disabled", "expanded", "selected", "pressed", "focused"] as const).flatMap((key) =>
        props.has(key) ? [`${key}=${props.get(key)}`] : [],
      )

      const context = options.interactive ? [inherited, branch.item].filter(Boolean).join(" / ") : ""
      const label = `[${role}] ${JSON.stringify(excerpt(name, interactive ? 300 : 160))}${flags.length ? ` ${flags.join(" ")}` : ""}${context ? ` in ${context}` : ""}`

      if (
        !query ||
        label.toLowerCase().includes(query) ||
        name.toLowerCase().includes(query) ||
        (known && `@${known}`.includes(query))
      ) {
        const pad = options.interactive ? "" : "  ".repeat(Math.min(12, branch.level))
        buckets[role === "RootWebArea" ? 0 : (priority ?? 5)].push({
          label: pad + label,
          id: interactive || known || area?.id === id ? id : undefined,
          interactive,
          area,
          overflow,
          deep: branch.level > (options.depth ?? Infinity),
        })
      }
    }

    if (editable) continue

    for (let i = children.length - 1; i >= 0; i--) {
      const child = index.get(children[i])

      if (child)
        pending.push({
          node: child,
          level: branch.level + Number(visible),
          parent: node.nodeId,
          parentName: visible ? name : branch.parentName,
          scope,
          item,
          priority,
          area,
          collection,
          overflow,
          ordinal: i + 1,
        })
    }
  }

  for (const group of overflowItems) if (!group.keep) group.area.skipped++

  return printSnapshot(buckets, options)
}

async function printSnapshot(buckets: Line[][], options: Options) {
  const refs = new Map<string, number>()
  const issued = new Map<number, string>()

  const ref = (id: number) => {
    const value = options.picked.get(id) ?? options.previous.get(id) ?? issued.get(id) ?? options.ref()
    issued.set(id, value)

    return value
  }

  const maxChars = options.maxChars ?? 20_000
  const maxLines = options.maxLines ?? Infinity
  const output: { line: Line; text: string }[] = []
  const areas = new Map<Area | undefined, number>()
  let omitted = 0
  let interactive = 0
  let size = 0
  let full = false
  let visited = 0

  const omit = (line: Line) => {
    omitted++
    interactive += Number(line.interactive)
    areas.set(line.area, (areas.get(line.area) ?? 0) + 1)
  }

  for (const bucket of buckets) {
    for (let i = 0; i < bucket.length; i += 32) {
      const batch = bucket.slice(i, i + 32)

      const boxes =
        options.box && !full && output.length < maxLines
          ? await Promise.all(
              batch.map((line) =>
                !line.deep && (!line.overflow || line.overflow.keep) && line.id ? options.box?.(line.id) : undefined,
              ),
            )
          : []

      for (const [j, line] of batch.entries()) {
        if (++visited % 2048 === 0) await setImmediate(undefined, { signal: options.signal })

        if ((line.overflow && !line.overflow.keep) || line.deep || full || output.length >= maxLines) {
          omit(line)
          continue
        }

        const key = line.id ? ref(line.id) : undefined
        const text = (key ? line.label.replace(/^\s*/, (pad) => `${pad}@${key} `) : line.label) + (boxes[j] ?? "")
        const length = size + Number(output.length > 0) + text.length

        if (length > maxChars) {
          full = true
          omit(line)
          continue
        }

        size = length
        output.push({ line, text })
      }
    }
  }

  const content = () => output.map(row => {
    if (row.line.id) refs.set(ref(row.line.id), row.line.id)

    return row.text
  }).join("\n")

  if (!omitted) return { content: content(), truncated: false, refs }

  const footer = () => {
    const places = Array.from(areas)
      .slice(0, 5)
      .map(([area, count]) => {
        if (!area) return `document (${count} nodes)`
        const key = ref(area.id)
        refs.set(key, area.id)

        return `${area.skipped ? `… +${area.skipped} more in ` : ""}@${key} [${area.role}] (${count} nodes)`
      })

    return `… ${omitted} nodes omitted (${interactive} interactive): ${places.join(", ")}${areas.size > 5 ? `; ${areas.size - 5} other containers` : ""}. Use find, snapshot({tabID, ref}), or raise maxChars/maxLines.`
  }

  let hint = footer()

  while (output.length && size + 1 + hint.length > maxChars) {
    const last = output.pop()

    if (!last) break
    omit(last.line)
    size -= last.text.length + Number(output.length > 0)
    hint = footer()
  }

  const separator = !output.length ? "" : output.length < maxLines ? "\n" : " "

  return { content: content() + separator + hint, truncated: true, refs }
}
