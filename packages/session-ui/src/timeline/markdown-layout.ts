import type { RichInlineItem } from "@chenglou/pretext/rich-inline"
import { createMarkdownBase } from "@opencode/ui/context/marked-base"
import { checksum } from "@opencode/util/encode"
import { isServer } from "solid-js/web"
import { sanitizeMarkdown } from "../components/markdown-cache"
import { inlineCodeKind } from "../components/markdown-inline-code-kind"
import { createBlockProjection, type Block, type Projection } from "../components/markdown-stream"
import type { PreparedMarkdown, PreparedMarkdownBlock } from "../components/markdown-prepared"
import type { createTimelineTextLayout, TimelineTypography } from "./text-layout"

/** Parse once per changed block. The exact same sanitized revision goes to the model and the renderer. */
export function createTimelineMarkdownLayout(text: ReturnType<typeof createTimelineTextLayout>) {
  const parser = createMarkdownBase()
  const compiled = new WeakMap<Block, { block: PreparedMarkdownBlock; elements: HTMLElement[] } | null>()
  const lists = new WeakMap<HTMLElement, HTMLElement[]>()

  const elementMeasurements = new WeakMap<
    HTMLElement,
    {
      width: number
      typography: TimelineTypography
      reasoning: boolean
      box: Box
    }
  >()

  const measurements = new WeakMap<
    PreparedMarkdown,
    {
      width: number
      typography: TimelineTypography
      height: number
      trailingMargin: number
      reasoning: boolean
    }
  >()

  const documents = new Map<
    string,
    {
      projection: Projection
      streaming: boolean
      prepared?: PreparedMarkdown
      unsupported: number[]
      elements: HTMLElement[][]
      project: ReturnType<typeof createBlockProjection>
    }
  >()

  function prepare(key: string, raw: string, streaming: boolean) {
    if (isServer) return
    const cached = documents.get(key)

    if (cached?.projection.text === raw && cached.streaming === streaming) return cached.prepared
    const project = cached?.project ?? createBlockProjection()
    const projection = project(raw, streaming)

    const blocks = projection.blocks.map((block) => {
      if (compiled.has(block)) return compiled.get(block)
      const value = compile(block)
      compiled.set(block, value ?? null)

      return value
    })

    const prepared = blocks.every((block) => block)
      ? { text: raw, blocks: blocks.map((value) => value!.block) }
      : undefined

    documents.set(key, {
      project,
      projection,
      streaming,
      prepared,
      unsupported: blocks.flatMap((value, index) => (value ? [] : [index])),
      elements: blocks.map((value) => value?.elements ?? []),
    })

    return prepared
  }

  function compile(block: Block) {
    if (block.mode === "code") {
      if (block.language === "mermaid") return

      return {
        block: {
          mode: "code",
          raw: block.raw,
          source: block.src,
          language: block.language ?? "text",
          complete: !!block.complete,
        } satisfies PreparedMarkdownBlock,
        elements: [],
      }
    }

    // Keep math and raw HTML on their renderer-specific sizing path.
    if (block.src.includes("<") || block.src.includes("\\(") || block.src.indexOf("$") !== block.src.lastIndexOf("$"))
      return
    const html = sanitizeMarkdown(parser.parse(block.src, { async: false }))
    const template = document.createElement("template")
    template.innerHTML = html

    if ([...template.content.childNodes].some((node) => node instanceof Text && node.data.trim())) return
    const elements = [...template.content.children].filter((node): node is HTMLElement => node instanceof HTMLElement)

    if (elements.some((element) => !/^(P|H[1-6]|UL|OL|BLOCKQUOTE|HR)$/.test(element.tagName))) return

    if (
      elements.some((element) =>
        [...element.querySelectorAll("*")].some(
          (node) =>
            !/^(P|UL|OL|LI|BLOCKQUOTE|STRONG|B|EM|I|DEL|S|CODE)$/.test(node.tagName) ||
            (node.tagName === "CODE" && /^https?:\/\//.test(node.textContent ?? "")),
        ),
      )
    )
      return

    return {
      block: {
        mode: block.mode,
        raw: block.raw,
        src: block.src,
        html,
        hash: checksum(html) ?? html,
      } satisfies PreparedMarkdownBlock,
      elements,
    }
  }

  return {
    prepare,
    layout(
      key: string,
      raw: string,
      streaming: boolean,
      width: number,
      typography: TimelineTypography,
      reasoning = false,
    ) {
      const prepared = prepare(key, raw, streaming)

      if (!prepared)
        return {
          source: "dom" as const,
          reason: "unsupported markdown block",
          blocks: documents.get(key)?.unsupported ?? [],
        }
      const previous = measurements.get(prepared)

      if (previous?.width === width && previous.typography === typography && previous.reasoning === reasoning)
        return {
          source: "pretext" as const,
          height: previous.height,
          trailingMargin: previous.trailingMargin,
        }
      const entry = documents.get(key)!

      const blocks = prepared.blocks.flatMap((block, blockIndex) => {
        if (block.mode === "code")
          return [
            {
              height:
                ((block.source ? block.source.split("\n").length - Number(block.source.endsWith("\n")) : 0) *
                  Math.round((reasoning ? 20 : typography.codeLineHeight) * 64)) /
                  64 +
                typography.codeInset,
              before: 12,
              after: 24,
              edgeBefore: 12,
              edgeAfter: 24,
            },
          ]

        return entry.elements[blockIndex]!.map((element, index) =>
          measure(element, `${key}:${blockIndex}:${index}`, width, typography, reasoning),
        )
      })

      const measured = {
        width,
        typography,
        reasoning,
        height: flowHeight(blocks) + (blocks[0]?.edgeBefore ?? 0) + (blocks.at(-1)?.edgeAfter ?? 0),
        trailingMargin: blocks.at(-1)?.edgeAfter ?? 0,
      }

      measurements.set(prepared, measured)

      return {
        source: "pretext" as const,
        height: measured.height,
        trailingMargin: measured.trailingMargin,
      }
    },
  }

  function measure(
    element: HTMLElement,
    key: string,
    width: number,
    typography: TimelineTypography,
    reasoning: boolean,
  ): Box {
    const cached = elementMeasurements.get(element)

    if (cached?.width === width && cached.typography === typography && cached.reasoning === reasoning) return cached.box
    const box = measureUncached(element, key, width, typography, reasoning)
    elementMeasurements.set(element, { width, typography, reasoning, box })

    return box
  }

  function measureUncached(
    element: HTMLElement,
    key: string,
    width: number,
    typography: TimelineTypography,
    reasoning: boolean,
  ): Box {
    const tag = element.tagName

    if (tag === "HR") return { height: 0, before: 32, after: 32 }

    if (tag === "UL" || tag === "OL" || tag === "BLOCKQUOTE") {
      const nested = element.parentElement?.tagName === "LI"

      const inset =
        tag === "BLOCKQUOTE"
          ? typography.rem * 0.5 + (typography.codeInset - 24) / 2
          : tag === "OL"
            ? typography.rem * (nested ? 1.75 : 2.25)
            : nested
              ? typography.rem
              : 32

      // SAFETY: rendered markdown holds only HTML elements.
      const children = [...element.children].map((child, index) =>
        measure(child as HTMLElement, `${key}:${index}`, width - inset, typography, reasoning),
      )

      return {
        height: flowHeight(children),
        edgeBefore: children[0]?.before ?? 0,
        edgeAfter: children.at(-1)?.after ?? 0,
        before: Math.max(
          tag === "BLOCKQUOTE" ? typography.rem : nested ? typography.rem * 0.25 : 8,
          children[0]?.before ?? 0,
        ),
        after: Math.max(
          tag === "BLOCKQUOTE" ? typography.rem : nested ? typography.rem * 0.25 : 12,
          children.at(-1)?.after ?? 0,
        ),
      }
    }

    if (tag === "LI") {
      const children = lists.get(element) ?? listChildren(element)
      lists.set(element, children)

      const parts = children.map((child, index) => {
        const box = measure(child, `${key}:${index}`, width, typography, reasoning)

        if (child.tagName === "SPAN") return { ...box, before: 0, after: 0 }

        return child.tagName === "P" ? { ...box, before: typography.rem * 0.5 } : box
      })

      return { height: flowHeight(parts), before: parts[0]?.before ?? 0, after: Math.max(8, parts.at(-1)?.after ?? 0) }
    }

    const heading = /^H[1-6]$/.test(tag)
    const size = reasoning ? 13 : tag === "H1" ? 17 : tag === "H2" ? 15 : heading ? 13 : typography.size

    const style = {
      ...typography,
      size,
      weight: !heading || reasoning ? typography.weight : tag === "H1" || tag === "H2" ? 600 : typography.medium,
    }

    return {
      height: text.rich(
        key,
        inline(element, style),
        width,
        Math.round((heading ? size * 1.5 : reasoning ? 20 : size * 1.6) * 64) / 64,
        typography.revision,
      ),
      before:
        reasoning && tag === "P" && element.querySelector("strong")
          ? element.previousElementSibling
            ? 24
            : 0
          : !heading
            ? 0
            : tag === "H1"
              ? 28
              : tag === "H2"
                ? 24
                : 20,
      after:
        reasoning && tag === "P" && element.querySelector("strong")
          ? 0
          : !heading || tag === "H1"
            ? 12
            : tag === "H2"
              ? 10
              : 8,
    }
  }
}

function listChildren(element: HTMLElement) {
  const children: HTMLElement[] = []
  let line = document.createElement("span")

  const flush = () => {
    if (!line.textContent?.trim()) return
    children.push(line)
    line = document.createElement("span")
  }

  ;[...element.childNodes].forEach((child) => {
    if (!(child instanceof HTMLElement) || !/^(P|UL|OL|BLOCKQUOTE)$/.test(child.tagName)) {
      line.append(child.cloneNode(true))

      return
    }

    if (child.tagName === "P" && child === element.firstElementChild) {
      line.append(...[...child.childNodes].map((node) => node.cloneNode(true)))

      return
    }

    flush()
    children.push(child)
  })
  flush()

  return children
}

type Box = { height: number; before: number; after: number; edgeBefore?: number; edgeAfter?: number }

function flowHeight(blocks: Box[]) {
  return blocks.reduce(
    (height, block, index) => height + block.height + (index ? Math.max(block.before, blocks[index - 1]!.after) : 0),
    0,
  )
}

function inline(element: HTMLElement, style: TimelineTypography, italic = false): RichInlineItem[] {
  return [...element.childNodes].flatMap((node): RichInlineItem[] => {
    if (node instanceof Text)
      return [
        {
          text: node.data,
          font: `${italic ? "italic " : ""}${style.weight} ${style.size}px ${style.family}`,
          letterSpacing: style.letterSpacing,
        },
      ]

    if (!(node instanceof HTMLElement)) return []

    if (node.tagName === "STRONG" || node.tagName === "B") return inline(node, { ...style, weight: style.bold }, italic)

    if (node.tagName === "EM" || node.tagName === "I") return inline(node, style, true)

    if (node.tagName === "CODE")
      return [
        {
          text: node.textContent ?? "",
          font: `${italic ? "italic " : ""}${style.medium} ${style.size}px ${style.codeFamily}`,
          letterSpacing: style.letterSpacing,
          extraWidth: inlineCodeKind(node.textContent ?? "") === "path" ? 4 : 8,
        },
      ]

    return inline(node, style, italic)
  })
}
