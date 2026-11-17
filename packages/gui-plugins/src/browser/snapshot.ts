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
  /** Whether a field's value may be printed; `name` is its accessible name. */
  readableValue?: (id: number, name: string) => Promise<boolean>
  signal?: AbortSignal
}

type Area = { id: number; role: string; skipped: number }

type Item = { area: Area; keep: boolean; meaningful: boolean; shown: number; parent?: Item }

type Branch = {
  node: Protocol.Accessibility.AXNode
  level: number
  parent: string
  parentName: string
  scope: string
  item: string
  ordinal: number
  emphasis?: boolean
  priority?: number
  area?: Area
  collection?: Area
  entry?: Item
}

type Line = {
  label: string
  value?: { text: string; name: string }
  id?: number
  interactive: boolean
  area?: Area
  entry?: Item
  important: boolean
  deep: boolean
  reading?: "heading" | "prose"
}

const controls =
  /^(button|link|textbox|searchbox|combobox|listbox|checkbox|radio|option|switch|tab|menuitem|menuitemcheckbox|menuitemradio|slider|spinbutton|treeitem|scrollbar)$/

const collections = /^(table|grid|treegrid|list|listbox|combobox|menu|tree)$/

const landmarks = /^(alert|dialog|alertdialog|main|form|search|region|navigation|contentinfo|banner|complementary)$/

function excerpt(name: string, limit: number) {
  return name.length <= limit ? name : `${name.slice(0, limit)}… [+${name.length - limit} chars]`
}

function rank(role: string) {
  if (role === "alert" || role === "alertdialog" || role === "dialog") return 1

  if (role === "main") return 2

  if (role === "form" || role === "search") return 3

  if (landmarks.test(role)) return 4
}

function itemLabel(children: readonly string[], index: ReadonlyMap<string, Protocol.Accessibility.AXNode>) {
  const pending = children.slice().reverse()
  const seen = new Set<string>()

  while (pending.length) {
    const id = pending.pop()

    if (!id || seen.has(id)) continue
    seen.add(id)
    const node = index.get(id)

    if (!node) continue
    const role = String(node.role?.value ?? "")

    if (controls.test(role) || collections.test(role) || role === "row" || role === "listitem" || node.properties?.some(p => p.name === "editable")) continue
    const name = String(node.name?.value ?? "").replace(/\s+/g," ").trim()

    if (!node.ignored && name) return name

    for (let i=(node.childIds?.length ?? 0)-1; i>=0; i--) {
      const child = node.childIds?.[i]

      if (child) pending.push(child)
    }
  }

  return ""
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
  const items: Item[] = []
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
      visible && id && (landmarks.test(role) || collections.test(role)) ? { id, role, skipped: 0 } : branch.area

    const collection = area && collections.test(area.role) ? area : branch.collection
    const priority = Math.min(branch.priority ?? 5, (visible && rank(role)) || 5)
    // A status or alert rarely has a name of its own; its text is the message.
    const emphasis = branch.emphasis || /^(heading|columnheader|rowheader|status|alert|alertdialog)$/.test(role)
    const inherited = headings.get(branch.parent) ?? branch.scope

    const scope =
      options.interactive && visible && name && (landmarks.test(role) || collections.test(role) || role === "heading")
        ? `${role} ${JSON.stringify(excerpt(name, 60))}`
        : inherited

    if (options.interactive && visible && role === "heading" && name) headings.set(branch.parent, scope)
    const children = node.childIds ?? []
    const isItem = visible && /^(row|listitem|option)$/.test(role)

    const itemName =
      options.interactive && (role === "row" || role === "listitem") && !name
        ? itemLabel(children, index)
        : name

    const item =
      options.interactive && isItem
        ? `${role} ${itemName ? JSON.stringify(excerpt(itemName, 60)) : branch.ordinal}`
        : branch.item

    const entry =
      isItem && collection
        ? { area: collection, keep: false, meaningful: false, shown: 0, parent: branch.entry }
        : branch.entry

    if (entry && entry !== branch.entry) items.push(entry)

    const important = !!node.properties?.some(
      (p) =>
        ["focused", "selected", "checked", "invalid"].includes(p.name) &&
        ![false, "false", undefined].includes(p.value.value),
    )

    if (visible && entry && (interactive || name.trim() || important)) {
      if (important) for (let group: Item | undefined = entry; group; group = group.parent) group.keep = true
    }

    if (visible && (!options.interactive || interactive)) {
      const flags = (
        [
          "checked",
          "disabled",
          "expanded",
          "selected",
          "pressed",
          "focused",
          "invalid",
          "required",
          "readonly",
        ] as const
      ).flatMap((key) =>
        props.has(key) &&
        !(["invalid", "required", "readonly"].includes(key) && [false, "false"].includes(props.get(key)))
          ? [`${key}=${props.get(key)}`]
          : [],
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

        if (entry && (interactive || name.trim() || important)) entry.meaningful = true
        buckets[role === "RootWebArea" ? 0 : (priority ?? 5)].push({
          label: pad + label,
          // An empty field prints no value and costs no page call.
          value:
            interactive && node.value?.value !== undefined && String(node.value.value) !== ""
              ? { text: JSON.stringify(excerpt(String(node.value.value), 160)), name }
              : undefined,
          id: interactive || known || area?.id === id ? id : undefined,
          interactive,
          area,
          entry,
          important,
          deep: branch.level > (options.depth ?? Infinity),
          reading: interactive || role === "RootWebArea" || !name.trim() ? undefined : emphasis ? "heading" : "prose",
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
          parent: visible ? node.nodeId : branch.parent,
          parentName: visible ? name : branch.parentName,
          scope,
          item,
          emphasis,
          priority,
          area,
          collection,
          entry,
          ordinal: i + 1,
        })
    }
  }

  return printSnapshot(buckets, items, options)
}

async function printSnapshot(buckets: Line[][], items: Item[], options: Options) {
  const refs = new Map<string, number>()
  const issued = new Map<number, string>()

  const ref = (id: number) => {
    const value = options.picked.get(id) ?? options.previous.get(id) ?? issued.get(id) ?? options.ref()
    issued.set(id, value)

    return value
  }

  const maxChars = options.maxChars ?? 20_000
  const maxLines = options.maxLines ?? Infinity
  const output: { line: Line; text: string; order: number }[] = []
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

  const ordered = buckets.flat()
  const order = new Map(ordered.map((line, i) => [line, i]))

  // Links alone can fill any budget and leave an article without its title or opening. Headings and text outside rows
  // and list items first take up to a quarter, in reading order; controls get what they leave. A larger share measured
  // fewer section headings on documentation pages, and cells would spend it on a table's first rows.
  const reading = options.interactive
    ? []
    : ordered.filter((line) => !line.deep && (line.reading === "heading" || (line.reading === "prose" && !line.entry)))

  const placed = new Set<Line>()

  for (const [pass, original] of [reading, ...buckets].entries()) {
    const chars = pass ? maxChars : maxChars / 4
    const lines = pass ? maxLines : maxLines / 4
    let spent = false
    // Select within each landmark's budget by usefulness, then restore tree order for reading.
    const groups = Array.from({ length: 4 }, (): Line[] => [])

    for (const line of original)
      if (!placed.has(line))
        groups[
          line.important || line.entry?.keep
            ? 0
            : line.interactive || line.reading === "heading"
              ? 1
              : line.area?.id === line.id && line.id
                ? 2
                : 3
        ].push(line)
    const bucket = pass ? groups.flat() : original

    for (let i = 0; i < bucket.length && !spent; i += 32) {
      const batch = bucket.slice(i, i + 32)

      const details =
        !full && output.length < lines
          ? await Promise.all(
              batch.map(async (line) => {
                if (!line.id || line.deep) return ""
                const readable = line.value && (await options.readableValue?.(line.id, line.value.name))
                const value = line.value ? ` value=${readable ? line.value.text : "<hidden>"}` : ""

                return value + ((await options.box?.(line.id)) ?? "")
              }),
            )
          : []

      for (const [j, line] of batch.entries()) {
        if (++visited % 2048 === 0) await setImmediate(undefined, { signal: options.signal })

        if (spent) continue

        // A reading line beyond the share keeps its place in its landmark.
        if (!pass && output.length >= lines) {
          spent = true
          continue
        }

        if (line.deep || full || output.length >= maxLines) {
          omit(line)
          continue
        }

        const key = line.id ? ref(line.id) : undefined
        const text = (key ? line.label.replace(/^\s*/, (pad) => `${pad}@${key} `) : line.label) + (details[j] ?? "")
        const length = size + Number(output.length > 0) + text.length

        if (length > chars && !pass) {
          spent = true
          continue
        }

        if (length > chars) {
          full = true
          omit(line)
          continue
        }

        size = length
        placed.add(line)
        output.push({ line, text, order: order.get(line) ?? 0 })
      }
    }
  }

  const content = () =>
    output
      .sort((a, b) => a.order - b.order)
      .map((row) => {
        if (row.line.id) refs.set(ref(row.line.id), row.line.id)

        return row.text
      })
      .join("\n")

  if (!omitted) return { content: content(), truncated: false, refs }

  for (const row of output) for (let group = row.line.entry; group; group = group.parent) group.shown++

  for (const group of items) if (group.meaningful && !group.shown) group.area.skipped++

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

    for (let group = last.line.entry; group; group = group.parent)
      if (--group.shown === 0 && group.meaningful) group.area.skipped++
    omit(last.line)
    size -= last.text.length + Number(output.length > 0)
    hint = footer()
  }

  const separator = !output.length ? "" : output.length < maxLines ? "\n" : " "

  return { content: content() + separator + hint, truncated: true, refs }
}
