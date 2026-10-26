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

export function createMarkdownRenderer(root: HTMLDivElement, html: string, words: boolean, animate = false) {
  const visible = () => root.isConnected && document.visibilityState !== "hidden"

  const [nodes, setNodes] = createStore(
    parseMarkdownNodes(html, words, animate && document.visibilityState !== "hidden"),
  )

  let ready = animate && document.visibilityState !== "hidden"
  let frontier = 0
  let observer: IntersectionObserver | undefined

  const observe = (element: HTMLElement) => {
    observer ??= new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        observer!.unobserve(entry.target)

        if (entry.isIntersecting) return
        // A clipped word is revealed by its container, not by an invisible opacity animation.
        entry.target.removeAttribute("data-markdown-enter")

        if (entry.target instanceof HTMLElement) entry.target.style.removeProperty("--markdown-word-delay")
      })
    })
    observer.observe(element)
  }

  const settle = () => {
    frontier = 0
    observer?.disconnect()
    root.querySelectorAll<HTMLElement>("[data-markdown-enter]").forEach((element) => {
      element.removeAttribute("data-markdown-enter")
      element.style.removeProperty("--markdown-word-delay")
    })
  }

  document.addEventListener("visibilitychange", settle)

  const delay = () => {
    const now = performance.now()

    const scale =
      typeof document !== "undefined"
        ? Number(document.documentElement?.style.getPropertyValue("--motion-time-scale")) || 1
        : 1

    const base = Math.max(now, frontier)
    const lead = (base - now) / scale
    const step = Math.max(5.5, Math.min(20, 20 - lead * 0.045)) * scale
    frontier = base + step

    return Math.max(0, Math.round(base - now))
  }

  const dispose = render(
    () => (
      <For each={nodes}>
        {(node) => <MarkdownDomNode node={node} animate={() => ready} delay={delay} observe={observe} />}
      </For>
    ),
    root,
  )

  ready = true

  return {
    update(next: string, nextWords: boolean, animate = true) {
      if (!visible()) settle()
      setNodes(reconcile(parseMarkdownNodes(next, nextWords, animate && visible()), { key: "key" }))
    },
    dispose() {
      document.removeEventListener("visibilitychange", settle)
      observer?.disconnect()
      dispose()
    },
  }
}

function MarkdownDomNode(props: {
  node: MarkdownNode
  animate: () => boolean
  delay: () => number
  observe: (element: HTMLElement) => void
}) {
  const node = props.node

  if (node.type === "text") return node.text

  if (node.type === "word") {
    let ref: HTMLSpanElement | undefined
    // Marked before it is inserted, so a word costs one style pass rather than one for insertion and one for its fade.
    const enter = props.animate() && node.animate
    const wait = enter ? props.delay() : 0
    onMount(() => {
      if (enter && ref) props.observe(ref)
    })

    return (
      <span
        ref={ref}
        data-markdown-word=""
        data-markdown-enter={enter ? "" : undefined}
        style={wait > 0 ? { "--markdown-word-delay": `${wait}ms` } : undefined}
        onAnimationEnd={(event) => {
          event.currentTarget.removeAttribute("data-markdown-enter")
          event.currentTarget.style.removeProperty("--markdown-word-delay")
        }}
      >
        {node.text}
      </span>
    )
  }

  let ref: HTMLElement | undefined
  onMount(() => {
    if (props.animate() && node.animate && ref) {
      ref.setAttribute("data-markdown-enter", "")
      props.observe(ref)
    }
  })

  return (
    <Dynamic component={node.tag} ref={ref} {...node.attributes}>
      <For each={node.children}>
        {(node) => <MarkdownDomNode node={node} animate={props.animate} delay={props.delay} observe={props.observe} />}
      </For>
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

      const word: MarkdownNode = { key: `${key}:${index}`, type: "word", text }

      if (animate) word.animate = true

      return [word]
    })
  }

  if (!(node instanceof Element)) return []

  const element: MarkdownNode = {
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

  if (words && animate && node.tagName === "CODE" && node.parentElement?.tagName !== "PRE") element.animate = true

  return [element]
}
