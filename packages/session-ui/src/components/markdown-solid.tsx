import { createRoot, For, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Dynamic, insert } from "solid-js/web"

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

export function createMarkdownRenderer(root: HTMLDivElement, html: string, words: boolean) {
  const [nodes, setNodes] = createStore(parseMarkdownNodes(html, words))
  let ready = false

  const dispose = createRoot((dispose) => {
    insert(
      root,
      <For each={nodes}>{(node) => <MarkdownDomNode node={node} animate={() => ready} />}</For>,
    )

    return dispose
  })

  ready = true

  return {
    update(next: string, nextWords: boolean, animate = true) {
      setNodes(reconcile(parseMarkdownNodes(next, nextWords, animate), { key: "key" }))
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

      const item: MarkdownNode = { key: `${key}:${index}`, type: "word", text }

      if (animate) item.animate = true

      return [item]
    })
  }

  if (!(node instanceof Element)) return []

  const element: Extract<MarkdownNode, { type: "element" }> = {
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
  }

  if (words && animate && node.tagName === "CODE" && node.parentElement?.tagName !== "PRE") {
    element.animate = true
  }

  return [element]
}

function resolveBoundary(node: Node, offset: number): [Node, number] {
  if (node instanceof HTMLElement && node.hasAttribute("data-markdown-word") && node.firstChild instanceof Text) {
    return [node.firstChild, offset === 0 ? 0 : node.firstChild.data.length]
  }

  return [node, offset]
}

export function unwrapMarkdownWords(root: HTMLElement) {
  for (const node of root.querySelectorAll<HTMLElement>("[data-markdown-enter]")) {
    node.removeAttribute("data-markdown-enter")
  }

  const spans = root.querySelectorAll<HTMLElement>("[data-markdown-word]")

  if (spans.length === 0) return
  const selection = window.getSelection?.()

  const inside =
    !!selection?.anchorNode &&
    !!selection.focusNode &&
    !selection.isCollapsed &&
    (root.contains(selection.anchorNode) || root.contains(selection.focusNode))

  const anchor = inside ? resolveBoundary(selection.anchorNode, selection.anchorOffset) : undefined
  const focus = inside ? resolveBoundary(selection.focusNode, selection.focusOffset) : undefined

  for (const span of spans) {
    span.replaceWith(...span.childNodes)
  }

  // Restoring base and extent keeps backward and in-progress drags anchored where they started.
  if (selection && anchor && focus) selection.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1])

  // Live ranges, including the selection, follow merged text nodes through normalize().
  root.normalize()
}

export function settleMarkdownWords(root: HTMLElement) {
  const hash = root.dataset.markdownHash

  const running = Array.from(root.querySelectorAll<HTMLElement>("[data-markdown-enter]")).flatMap((node) =>
    (node.getAnimations?.() ?? []).filter((animation) => animation.playState === "running"),
  )

  if (running.length === 0) {
    unwrapMarkdownWords(root)

    return
  }

  void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
    if (!root.isConnected || root.dataset.markdownMode === "live" || root.dataset.markdownHash !== hash) return
    unwrapMarkdownWords(root)
  })
}
