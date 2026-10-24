import { batch, For, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Dynamic, render } from "solid-js/web"

type MarkdownNode =
  | {
      key: string
      type: "element"
      tag: string
      attributes: Record<string, string>
      children: MarkdownNode[]
      animate?: true
    }
  | { key: string; type: "text"; text: string }
  | { key: string; type: "word"; text: string; animate?: true }

// A store path from the root array down to the array the walk is currently in.
type NodePath = (string | number)[]

// `setStore` takes the path as arguments, so a dynamic path needs one cast.
type SetNode = (path: NodePath, value: unknown) => void

export function createMarkdownRenderer(root: HTMLDivElement, html: string, words: boolean) {
  const tree = parseMarkdownNodes(html, words)
  const [nodes, setNodes] = createStore(tree)
  const set: SetNode = (path, value) => (setNodes as (...args: unknown[]) => void)(...path, value)
  let ready = false

  const dispose = render(
    () => <For each={nodes}>{(node) => <MarkdownDomNode node={node} animate={() => ready} />}</For>,
    root,
  )

  ready = true

  return {
    update(next: string, nextWords: boolean, animate = true) {
      const parsed = parseMarkdownNodes(next, nextWords, animate)

      // One batch keeps the appended children from re-diffing the block once per write.
      if (batch(() => appendTail(tree, parsed, [], set))) return

      setNodes(reconcile(parsed, { key: "key" }))
    },
    dispose,
  }
}

function MarkdownDomNode(props: { node: MarkdownNode; animate: () => boolean }) {
  const node = props.node

  if (node.type === "text") return node.text

  if (node.type === "word") {
    let ref: HTMLSpanElement | undefined
    onMount(() => {
      if (props.animate() && node.animate) ref?.setAttribute("data-markdown-enter", "")
    })

    return (
      <span ref={ref} data-markdown-word="">
        {node.text}
      </span>
    )
  }

  let ref: HTMLElement | undefined
  onMount(() => {
    if (props.animate() && node.animate) ref?.setAttribute("data-markdown-enter", "")
  })

  return (
    <Dynamic component={node.tag} ref={ref} {...node.attributes}>
      <For each={node.children}>{(node) => <MarkdownDomNode node={node} animate={props.animate} />}</For>
    </Dynamic>
  )
}

export function parseMarkdownNodes(html: string, words: boolean, animate = false) {
  const template = document.createElement("template")
  template.innerHTML = html

  return Array.from(template.content.childNodes).flatMap((node, index) => parseNode(node, `${index}`, words, animate))
}

function parseNode(node: Node, key: string, words: boolean, animate: boolean, inlineCode = false): MarkdownNode[] {
  if (node instanceof Text) {
    if (!words) return [{ key, type: "text", text: node.data }]

    return (inlineCode ? Array.from(node.data) : node.data.split(/(\s+)/)).flatMap((text, index): MarkdownNode[] => {
      if (!text) return []

      if (/^\s+$/.test(text)) return [{ key: `${key}:${index}`, type: "text", text }]

      return [{ key: `${key}:${index}`, type: "word", text, ...(animate ? { animate: true as const } : {}) }]
    })
  }

  if (!(node instanceof Element)) return []

  return [
    {
      key,
      type: "element",
      tag: node.tagName.toLowerCase(),
      attributes: Object.fromEntries(Array.from(node.attributes).map((attribute) => [attribute.name, attribute.value])),
      children: Array.from(node.childNodes).flatMap((child, index) =>
        parseNode(
          child,
          `${key}.${index}`,
          words,
          animate,
          inlineCode || (node.tagName === "CODE" && node.parentElement?.tagName !== "PRE"),
        ),
      ),
      ...(words && animate && node.tagName === "CODE" && node.parentElement?.tagName !== "PRE"
        ? { animate: true as const }
        : {}),
    },
  ]
}

// A delta only appends to the tail of the block, so the store can be updated by path instead of
// handing the whole tree to `reconcile`. `previous` is the store's own plain tree, so the walk
// never reads through the store proxy, and only the changed node and the new children are written.
// Returns false when the delta changed more than the tail, which leaves the caller to `reconcile`.
function appendTail(previous: readonly MarkdownNode[], parsed: readonly MarkdownNode[], path: NodePath, set: SetNode): boolean {
  if (parsed.length < previous.length) return false
  for (let index = 0; index < previous.length - 1; index++) if (!sameNode(previous[index], parsed[index])) return false

  if (previous.length > 0) {
    const last = previous.length - 1
    if (!sameNode(previous[last], parsed[last]) && !appendTailNode(previous[last], parsed[last], path.concat(last), set))
      return false
  }

  for (let index = previous.length; index < parsed.length; index++) set(path.concat(index), parsed[index])
  return true
}

// The live node is the one that changes on every delta, so it is extended in place: a grown word
// keeps its span, and an element keeps its children and only gains the new ones.
function appendTailNode(previous: MarkdownNode, parsed: MarkdownNode, path: NodePath, set: SetNode): boolean {
  if (previous.key !== parsed.key) return false

  if (previous.type === "element" && parsed.type === "element") {
    if (previous.tag !== parsed.tag || !sameAttributes(previous.attributes, parsed.attributes)) return false

    return appendTail(previous.children, parsed.children, path.concat("children"), set)
  }

  if (previous.type === "text" && parsed.type === "text") {
    set(path.concat("text"), parsed.text)
    return true
  }

  if (previous.type === "word" && parsed.type === "word") {
    set(path.concat("text"), parsed.text)
    if (!!previous.animate !== !!parsed.animate) set(path.concat("animate"), parsed.animate)
    return true
  }

  return false
}

function sameNode(previous: MarkdownNode, node: MarkdownNode): boolean {
  if (previous.key !== node.key || previous.type !== node.type) return false

  if (node.type === "text") return previous.type === "text" && previous.text === node.text

  if (node.type === "word")
    return previous.type === "word" && previous.text === node.text && !!previous.animate === !!node.animate

  if (previous.type !== "element") return false

  return (
    previous.tag === node.tag &&
    !!previous.animate === !!node.animate &&
    sameAttributes(previous.attributes, node.attributes) &&
    previous.children.length === node.children.length &&
    previous.children.every((child, index) => {
      const next = node.children[index]

      return !!next && sameNode(child, next)
    })
  )
}

function sameAttributes(previous: Record<string, string>, next: Record<string, string>) {
  const keys = Object.keys(previous)

  return keys.length === Object.keys(next).length && keys.every((key) => previous[key] === next[key])
}
