import { For, onMount } from "solid-js"
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

export function createMarkdownRenderer(root: HTMLDivElement, source: ParentNode, words: boolean) {
  const [nodes, setNodes] = createStore(parseMarkdownNodes(source, words))
  let ready = false

  const dispose = render(
    () => <For each={nodes}>{(node) => <MarkdownDomNode node={node} animate={() => ready} />}</For>,
    root,
  )

  ready = true

  return {
    update(next: ParentNode, nextWords: boolean, animate = true) {
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

export function parseMarkdownNodes(source: ParentNode, words: boolean, animate = false) {
  return Array.from(source.childNodes).flatMap((node, index) => parseNode(node, `${index}`, words, animate))
}

function parseNode(node: Node, key: string, words: boolean, animate: boolean, inlineCode = false): MarkdownNode[] {
  if (node instanceof Text) {
    if (!words) return [{ key, type: "text", text: node.data }]

    return (inlineCode ? Array.from(node.data) : node.data.split(/(\s+)/)).flatMap((text, index): MarkdownNode[] => {
      if (!text) return []

      if (/^\s+$/.test(text)) return [{ key: `${key}:${index}`, type: "text", text }]
      const word: Extract<MarkdownNode, { type: "word" }> = { key: `${key}:${index}`, type: "word", text }

      if (animate) word.animate = true

      return [word]
    })
  }

  if (!(node instanceof Element)) return []
  const code = node.tagName === "CODE" && node.parentElement?.tagName !== "PRE"

  const element: Extract<MarkdownNode, { type: "element" }> = {
    key,
    type: "element",
    tag: node.tagName.toLowerCase(),
    attributes: Object.fromEntries(Array.from(node.attributes).map((attribute) => [attribute.name, attribute.value])),
    children: Array.from(node.childNodes).flatMap((child, index) =>
      parseNode(child, `${key}.${index}`, words, animate, inlineCode || code),
    ),
  }

  if (words && animate && code) element.animate = true

  return [element]
}
