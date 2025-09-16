import { bundledLanguages, codeToHtml, type ShikiTransformer } from "shiki"
import {
  createResource,
  splitProps,
  Suspense,
  type ComponentProps,
  createEffect,
  onMount,
  onCleanup,
  createMemo,
} from "solid-js"
import { useLocal } from "@/context"
import { getFileExtension, getNodeOffsetInLine, getSelectionInContainer } from "@/utils"

interface Props extends ComponentProps<"div"> {
  code: string
  path: string
}

function transformerUnifiedDiff(): ShikiTransformer {
  const kinds = new Map<number, string>()
  const meta = new Map<number, { old?: number; new?: number; sign?: string }>()
  let isDiff = false

  return {
    name: "unified-diff",
    preprocess(input) {
      kinds.clear()
      meta.clear()
      isDiff = false

      const ls = input.split(/\r?\n/)
      const out: Array<string> = []
      let oldNo = 0
      let newNo = 0
      let inHunk = false

      for (let i = 0; i < ls.length; i++) {
        const s = ls[i]

        const m = s.match(/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/)
        if (m) {
          isDiff = true
          inHunk = true
          oldNo = parseInt(m[1], 10)
          newNo = parseInt(m[3], 10)
          continue
        }

        if (
          /^diff --git /.test(s) ||
          /^Index: /.test(s) ||
          /^--- /.test(s) ||
          /^\+\+\+ /.test(s) ||
          /^[=]{3,}$/.test(s) ||
          /^\*{3,}$/.test(s) ||
          /^\\ No newline at end of file$/.test(s)
        ) {
          isDiff = true
          continue
        }

        if (!inHunk) {
          out.push(s)
          continue
        }

        if (/^\+/.test(s)) {
          out.push(s)
          const ln = out.length
          kinds.set(ln, "add")
          meta.set(ln, { new: newNo, sign: "+" })
          newNo++
          continue
        }

        if (/^-/.test(s)) {
          out.push(s)
          const ln = out.length
          kinds.set(ln, "remove")
          meta.set(ln, { old: oldNo, sign: "-" })
          oldNo++
          continue
        }

        if (/^ /.test(s)) {
          out.push(s)
          const ln = out.length
          kinds.set(ln, "context")
          meta.set(ln, { old: oldNo, new: newNo })
          oldNo++
          newNo++
          continue
        }

        // fallback in hunks
        out.push(s)
      }

      return out.join("\n")
    },
    code(node) {
      if (isDiff) this.addClassToHast(node, "code-diff")
    },
    pre(node) {
      if (isDiff) this.addClassToHast(node, "code-diff")
    },
    line(node, line) {
      if (!isDiff) return
      const kind = kinds.get(line)
      if (!kind) return

      const m = meta.get(line) || {}

      this.addClassToHast(node, "diff-line")
      this.addClassToHast(node, `diff-${kind}`)
      node.properties = node.properties || {}
      ;(node.properties as any)["data-diff"] = kind
      if (m.old != undefined) (node.properties as any)["data-old"] = String(m.old)
      if (m.new != undefined) (node.properties as any)["data-new"] = String(m.new)

      const oldSpan = {
        type: "element",
        tagName: "span",
        properties: { className: ["diff-oldln"] },
        children: [{ type: "text", value: m.old != undefined ? String(m.old) : " " }],
      }
      const newSpan = {
        type: "element",
        tagName: "span",
        properties: { className: ["diff-newln"] },
        children: [{ type: "text", value: m.new != undefined ? String(m.new) : " " }],
      }

      if (kind === "add" || kind === "remove" || kind === "context") {
        const first = (node.children && (node.children as any[])[0]) as any
        if (first && first.type === "element" && first.children && first.children.length > 0) {
          const t = first.children[0]
          if (t && t.type === "text" && typeof t.value === "string" && t.value.length > 0) {
            const ch = t.value[0]
            if (ch === "+" || ch === "-" || ch === " ") t.value = t.value.slice(1)
          }
        }
      }

      const signSpan = {
        type: "element",
        tagName: "span",
        properties: { className: ["diff-sign"] },
        children: [{ type: "text", value: (m as any).sign || " " }],
      }

      // @ts-expect-error hast typing across versions
      node.children = [oldSpan, newSpan, signSpan, ...(node.children || [])]
    },
  }
}

function transformerDiffGroups(): ShikiTransformer {
  let group = -1
  let inGroup = false
  return {
    name: "diff-groups",
    pre() {
      group = -1
      inGroup = false
    },
    line(node) {
      const props = (node.properties || {}) as any
      const kind = props["data-diff"] as string | undefined
      if (kind === "add" || kind === "remove") {
        if (!inGroup) {
          group += 1
          inGroup = true
        }
        ;(node.properties as any)["data-chgrp"] = String(group)
      } else {
        inGroup = false
      }
    },
  }
}

function applyDiffFolding(
  root: HTMLElement,
  context = 3,
  options?: { expanded?: string[]; onExpand?: (key: string) => void; side?: "left" | "right" },
) {
  if (!root.classList.contains("code-diff")) return

  // Cleanup: unwrap previous collapsed blocks and remove toggles
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(".diff-collapsed-block"))
  for (const block of blocks) {
    const p = block.parentNode
    if (!p) {
      block.remove()
      continue
    }
    while (block.firstChild) p.insertBefore(block.firstChild, block)
    block.remove()
  }
  const toggles = Array.from(root.querySelectorAll<HTMLElement>(".diff-collapsed"))
  for (const t of toggles) t.remove()

  const lines = Array.from(root.querySelectorAll<HTMLElement>(".diff-line"))
  if (lines.length === 0) return

  const n = lines.length
  const isChange = lines.map((l) => l.dataset["diff"] === "add" || l.dataset["diff"] === "remove")
  const isContext = lines.map((l) => l.dataset["diff"] === "context")
  if (!isChange.some(Boolean)) return

  const visible = new Array(n).fill(false) as boolean[]
  for (let i = 0; i < n; i++) if (isChange[i]) visible[i] = true
  for (let i = 0; i < n; i++) {
    if (isChange[i]) {
      const s = Math.max(0, i - context)
      const e = Math.min(n - 1, i + context)
      for (let j = s; j <= e; j++) if (isContext[j]) visible[j] = true
    }
  }

  type Range = { start: number; end: number }
  const ranges: Range[] = []
  let i = 0
  while (i < n) {
    if (!visible[i] && isContext[i]) {
      let j = i
      while (j + 1 < n && !visible[j + 1] && isContext[j + 1]) j++
      ranges.push({ start: i, end: j })
      i = j + 1
    } else {
      i++
    }
  }

  for (const r of ranges) {
    const start = lines[r.start]
    const end = lines[r.end]
    const count = r.end - r.start + 1
    const minCollapse = 20
    if (count < minCollapse) {
      continue
    }

    // Wrap the entire collapsed chunk (including trailing newline) so it takes no space
    const block = document.createElement("span")
    block.className = "diff-collapsed-block"
    start.parentElement?.insertBefore(block, start)

    let cur: Node | undefined = start
    while (cur) {
      const next: Node | undefined = cur.nextSibling || undefined
      block.appendChild(cur)
      if (cur === end) {
        // Also move the newline after the last line into the block
        if (next && next.nodeType === Node.TEXT_NODE && (next.textContent || "").startsWith("\n")) {
          block.appendChild(next)
        }
        break
      }
      cur = next
    }

    block.style.display = "none"
    const row = document.createElement("span")
    row.className = "line diff-collapsed"
    row.setAttribute("data-kind", "collapsed")
    row.setAttribute("data-count", String(count))
    row.setAttribute("tabindex", "0")
    row.setAttribute("role", "button")

    const oldln = document.createElement("span")
    oldln.className = "diff-oldln"
    oldln.textContent = " "

    const newln = document.createElement("span")
    newln.className = "diff-newln"
    newln.textContent = " "

    const sign = document.createElement("span")
    sign.className = "diff-sign"
    sign.textContent = "…"

    const label = document.createElement("span")
    label.textContent = `show ${count} unchanged line${count > 1 ? "s" : ""}`

    const key = `o${start.dataset["old"] || ""}-${end.dataset["old"] || ""}:n${start.dataset["new"] || ""}-${end.dataset["new"] || ""}`

    const show = (record = true) => {
      if (record) options?.onExpand?.(key)
      const p = block.parentNode
      if (p) {
        while (block.firstChild) p.insertBefore(block.firstChild, block)
        block.remove()
      }
      row.remove()
    }

    row.addEventListener("click", () => show(true))
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault()
        show(true)
      }
    })

    block.parentElement?.insertBefore(row, block)
    if (!options?.side || options.side === "left") row.appendChild(oldln)
    if (!options?.side || options.side === "right") row.appendChild(newln)
    row.appendChild(sign)
    row.appendChild(label)

    if (options?.expanded && options.expanded.includes(key)) {
      show(false)
    }
  }
}

function applySplitDiff(container: HTMLElement) {
  const pres = Array.from(container.querySelectorAll<HTMLPreElement>("pre"))
  if (pres.length === 0) return
  const originalPre = pres[0]
  const originalCode = originalPre.querySelector("code") as HTMLElement | undefined
  if (!originalCode || !originalCode.classList.contains("code-diff")) return

  // Rebuild split each time to match current content
  const existing = container.querySelector<HTMLElement>(".diff-split")
  if (existing) existing.remove()

  const grid = document.createElement("div")
  grid.className = "diff-split grid grid-cols-2 gap-x-6"

  const makeColumn = () => {
    const pre = document.createElement("pre")
    pre.className = originalPre.className
    const code = document.createElement("code")
    code.className = originalCode.className
    pre.appendChild(code)
    return { pre, code }
  }

  const left = makeColumn()
  const right = makeColumn()

  // Helpers
  const cloneSide = (line: HTMLElement, side: "old" | "new"): HTMLElement => {
    const clone = line.cloneNode(true) as HTMLElement
    const oldln = clone.querySelector(".diff-oldln")
    const newln = clone.querySelector(".diff-newln")
    if (side === "old") {
      if (newln) newln.remove()
    } else {
      if (oldln) oldln.remove()
    }
    return clone
  }

  const blankLine = (side: "old" | "new", kind: "add" | "remove"): HTMLElement => {
    const span = document.createElement("span")
    span.className = "line diff-line diff-blank"
    span.setAttribute("data-diff", kind)
    const ln = document.createElement("span")
    ln.className = side === "old" ? "diff-oldln" : "diff-newln"
    ln.textContent = " "
    span.appendChild(ln)
    return span
  }

  const lines = Array.from(originalCode.querySelectorAll<HTMLElement>(".diff-line"))
  let i = 0
  while (i < lines.length) {
    const cur = lines[i]
    const kind = cur.dataset["diff"]

    if (kind === "context") {
      left.code.appendChild(cloneSide(cur, "old"))
      left.code.appendChild(document.createTextNode("\n"))
      right.code.appendChild(cloneSide(cur, "new"))
      right.code.appendChild(document.createTextNode("\n"))
      i++
      continue
    }

    if (kind === "remove") {
      // Batch consecutive removes and following adds, then pair
      const removes: HTMLElement[] = []
      const adds: HTMLElement[] = []
      let j = i
      while (j < lines.length && lines[j].dataset["diff"] === "remove") {
        removes.push(lines[j])
        j++
      }
      let k = j
      while (k < lines.length && lines[k].dataset["diff"] === "add") {
        adds.push(lines[k])
        k++
      }

      const pairs = Math.min(removes.length, adds.length)
      for (let p = 0; p < pairs; p++) {
        left.code.appendChild(cloneSide(removes[p], "old"))
        left.code.appendChild(document.createTextNode("\n"))
        right.code.appendChild(cloneSide(adds[p], "new"))
        right.code.appendChild(document.createTextNode("\n"))
      }
      for (let p = pairs; p < removes.length; p++) {
        left.code.appendChild(cloneSide(removes[p], "old"))
        left.code.appendChild(document.createTextNode("\n"))
        right.code.appendChild(blankLine("new", "remove"))
        right.code.appendChild(document.createTextNode("\n"))
      }
      for (let p = pairs; p < adds.length; p++) {
        left.code.appendChild(blankLine("old", "add"))
        left.code.appendChild(document.createTextNode("\n"))
        right.code.appendChild(cloneSide(adds[p], "new"))
        right.code.appendChild(document.createTextNode("\n"))
      }

      i = k
      continue
    }

    if (kind === "add") {
      // Run of adds not preceded by removes
      const adds: HTMLElement[] = []
      let j = i
      while (j < lines.length && lines[j].dataset["diff"] === "add") {
        adds.push(lines[j])
        j++
      }
      for (let p = 0; p < adds.length; p++) {
        left.code.appendChild(blankLine("old", "add"))
        left.code.appendChild(document.createTextNode("\n"))
        right.code.appendChild(cloneSide(adds[p], "new"))
        right.code.appendChild(document.createTextNode("\n"))
      }
      i = j
      continue
    }

    // Any other kind: mirror as context
    left.code.appendChild(cloneSide(cur, "old"))
    left.code.appendChild(document.createTextNode("\n"))
    right.code.appendChild(cloneSide(cur, "new"))
    right.code.appendChild(document.createTextNode("\n"))
    i++
  }

  grid.appendChild(left.pre)
  grid.appendChild(right.pre)
  container.appendChild(grid)
}

export function Code(props: Props) {
  const ctx = useLocal()
  const [local, others] = splitProps(props, ["class", "classList", "code", "path"])
  const lang = createMemo(() => getFileExtension(local.path))

  let container: HTMLDivElement | undefined
  let isProgrammaticSelection = false

  const [html] = createResource(
    () => [local.code, lang()],
    async ([code, lang]) => {
      return (await codeToHtml(code || "", {
        lang: lang && lang in bundledLanguages ? lang : "text",
        theme: {
          colors: {
            "actionBar.toggledBackground": "var(--theme-background-element)",
            "activityBarBadge.background": "var(--theme-accent)",
            "checkbox.border": "var(--theme-border)",
            "editor.background": "transparent",
            "editor.foreground": "var(--theme-text)",
            "editor.inactiveSelectionBackground": "var(--theme-background-element)",
            "editor.selectionHighlightBackground": "var(--theme-border-active)",
            "editorIndentGuide.activeBackground1": "var(--theme-border-subtle)",
            "editorIndentGuide.background1": "var(--theme-border-subtle)",
            "input.placeholderForeground": "var(--theme-text-muted)",
            "list.activeSelectionIconForeground": "var(--theme-text)",
            "list.dropBackground": "var(--theme-background-element)",
            "menu.background": "var(--theme-background-panel)",
            "menu.border": "var(--theme-border)",
            "menu.foreground": "var(--theme-text)",
            "menu.selectionBackground": "var(--theme-primary)",
            "menu.separatorBackground": "var(--theme-border)",
            "ports.iconRunningProcessForeground": "var(--theme-success)",
            "sideBarSectionHeader.background": "transparent",
            "sideBarSectionHeader.border": "var(--theme-border-subtle)",
            "sideBarTitle.foreground": "var(--theme-text-muted)",
            "statusBarItem.remoteBackground": "var(--theme-success)",
            "statusBarItem.remoteForeground": "var(--theme-text)",
            "tab.lastPinnedBorder": "var(--theme-border-subtle)",
            "tab.selectedBackground": "var(--theme-background-element)",
            "tab.selectedForeground": "var(--theme-text-muted)",
            "terminal.inactiveSelectionBackground": "var(--theme-background-element)",
            "widget.border": "var(--theme-border)",
          },
          displayName: "opencode",
          name: "opencode",
          semanticHighlighting: true,
          semanticTokenColors: {
            customLiteral: "var(--theme-syntax-function)",
            newOperator: "var(--theme-syntax-operator)",
            numberLiteral: "var(--theme-syntax-number)",
            stringLiteral: "var(--theme-syntax-string)",
          },
          tokenColors: [
            {
              scope: [
                "meta.embedded",
                "source.groovy.embedded",
                "string meta.image.inline.markdown",
                "variable.legacy.builtin.python",
              ],
              settings: {
                foreground: "var(--theme-text)",
              },
            },
            {
              scope: "emphasis",
              settings: {
                fontStyle: "italic",
              },
            },
            {
              scope: "strong",
              settings: {
                fontStyle: "bold",
              },
            },
            {
              scope: "header",
              settings: {
                foreground: "var(--theme-markdown-heading)",
              },
            },
            {
              scope: "comment",
              settings: {
                foreground: "var(--theme-syntax-comment)",
              },
            },
            {
              scope: "constant.language",
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: [
                "constant.numeric",
                "variable.other.enummember",
                "keyword.operator.plus.exponent",
                "keyword.operator.minus.exponent",
              ],
              settings: {
                foreground: "var(--theme-syntax-number)",
              },
            },
            {
              scope: "constant.regexp",
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: "entity.name.tag",
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: ["entity.name.tag.css", "entity.name.tag.less"],
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: "entity.other.attribute-name",
              settings: {
                foreground: "var(--theme-syntax-variable)",
              },
            },
            {
              scope: [
                "entity.other.attribute-name.class.css",
                "source.css entity.other.attribute-name.class",
                "entity.other.attribute-name.id.css",
                "entity.other.attribute-name.parent-selector.css",
                "entity.other.attribute-name.parent.less",
                "source.css entity.other.attribute-name.pseudo-class",
                "entity.other.attribute-name.pseudo-element.css",
                "source.css.less entity.other.attribute-name.id",
                "entity.other.attribute-name.scss",
              ],
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: "invalid",
              settings: {
                foreground: "var(--theme-error)",
              },
            },
            {
              scope: "markup.underline",
              settings: {
                fontStyle: "underline",
              },
            },
            {
              scope: "markup.bold",
              settings: {
                fontStyle: "bold",
                foreground: "var(--theme-markdown-strong)",
              },
            },
            {
              scope: "markup.heading",
              settings: {
                fontStyle: "bold",
                foreground: "var(--theme-markdown-heading)",
              },
            },
            {
              scope: "markup.italic",
              settings: {
                fontStyle: "italic",
              },
            },
            {
              scope: "markup.strikethrough",
              settings: {
                fontStyle: "strikethrough",
              },
            },
            {
              scope: "markup.inserted",
              settings: {
                foreground: "var(--theme-diff-added)",
              },
            },
            {
              scope: "markup.deleted",
              settings: {
                foreground: "var(--theme-diff-removed)",
              },
            },
            {
              scope: "markup.changed",
              settings: {
                foreground: "var(--theme-diff-context)",
              },
            },
            {
              scope: "punctuation.definition.quote.begin.markdown",
              settings: {
                foreground: "var(--theme-markdown-block-quote)",
              },
            },
            {
              scope: "punctuation.definition.list.begin.markdown",
              settings: {
                foreground: "var(--theme-markdown-list-enumeration)",
              },
            },
            {
              scope: "markup.inline.raw",
              settings: {
                foreground: "var(--theme-markdown-code)",
              },
            },
            {
              scope: "punctuation.definition.tag",
              settings: {
                foreground: "var(--theme-syntax-punctuation)",
              },
            },
            {
              scope: ["meta.preprocessor", "entity.name.function.preprocessor"],
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: "meta.preprocessor.string",
              settings: {
                foreground: "var(--theme-syntax-string)",
              },
            },
            {
              scope: "meta.preprocessor.numeric",
              settings: {
                foreground: "var(--theme-syntax-number)",
              },
            },
            {
              scope: "meta.structure.dictionary.key.python",
              settings: {
                foreground: "var(--theme-syntax-variable)",
              },
            },
            {
              scope: "meta.diff.header",
              settings: {
                foreground: "var(--theme-diff-hunk-header)",
              },
            },
            {
              scope: "storage",
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: "storage.type",
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: ["storage.modifier", "keyword.operator.noexcept"],
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: ["string", "meta.embedded.assembly"],
              settings: {
                foreground: "var(--theme-syntax-string)",
              },
            },
            {
              scope: "string.tag",
              settings: {
                foreground: "var(--theme-syntax-string)",
              },
            },
            {
              scope: "string.value",
              settings: {
                foreground: "var(--theme-syntax-string)",
              },
            },
            {
              scope: "string.regexp",
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: [
                "punctuation.definition.template-expression.begin",
                "punctuation.definition.template-expression.end",
                "punctuation.section.embedded",
              ],
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: ["meta.template.expression"],
              settings: {
                foreground: "var(--theme-text)",
              },
            },
            {
              scope: [
                "support.type.vendored.property-name",
                "support.type.property-name",
                "source.css variable",
                "source.coffee.embedded",
              ],
              settings: {
                foreground: "var(--theme-syntax-variable)",
              },
            },
            {
              scope: "keyword",
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: "keyword.control",
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: "keyword.operator",
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: [
                "keyword.operator.new",
                "keyword.operator.expression",
                "keyword.operator.cast",
                "keyword.operator.sizeof",
                "keyword.operator.alignof",
                "keyword.operator.typeid",
                "keyword.operator.alignas",
                "keyword.operator.instanceof",
                "keyword.operator.logical.python",
                "keyword.operator.wordlike",
              ],
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: "keyword.other.unit",
              settings: {
                foreground: "var(--theme-syntax-number)",
              },
            },
            {
              scope: ["punctuation.section.embedded.begin.php", "punctuation.section.embedded.end.php"],
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: "support.function.git-rebase",
              settings: {
                foreground: "var(--theme-syntax-variable)",
              },
            },
            {
              scope: "constant.sha.git-rebase",
              settings: {
                foreground: "var(--theme-syntax-number)",
              },
            },
            {
              scope: [
                "storage.modifier.import.java",
                "variable.language.wildcard.java",
                "storage.modifier.package.java",
              ],
              settings: {
                foreground: "var(--theme-text)",
              },
            },
            {
              scope: "variable.language",
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: [
                "entity.name.function",
                "support.function",
                "support.constant.handlebars",
                "source.powershell variable.other.member",
                "entity.name.operator.custom-literal",
              ],
              settings: {
                foreground: "var(--theme-syntax-function)",
              },
            },
            {
              scope: [
                "support.class",
                "support.type",
                "entity.name.type",
                "entity.name.namespace",
                "entity.other.attribute",
                "entity.name.scope-resolution",
                "entity.name.class",
                "storage.type.numeric.go",
                "storage.type.byte.go",
                "storage.type.boolean.go",
                "storage.type.string.go",
                "storage.type.uintptr.go",
                "storage.type.error.go",
                "storage.type.rune.go",
                "storage.type.cs",
                "storage.type.generic.cs",
                "storage.type.modifier.cs",
                "storage.type.variable.cs",
                "storage.type.annotation.java",
                "storage.type.generic.java",
                "storage.type.java",
                "storage.type.object.array.java",
                "storage.type.primitive.array.java",
                "storage.type.primitive.java",
                "storage.type.token.java",
                "storage.type.groovy",
                "storage.type.annotation.groovy",
                "storage.type.parameters.groovy",
                "storage.type.generic.groovy",
                "storage.type.object.array.groovy",
                "storage.type.primitive.array.groovy",
                "storage.type.primitive.groovy",
              ],
              settings: {
                foreground: "var(--theme-syntax-type)",
              },
            },
            {
              scope: [
                "meta.type.cast.expr",
                "meta.type.new.expr",
                "support.constant.math",
                "support.constant.dom",
                "support.constant.json",
                "entity.other.inherited-class",
                "punctuation.separator.namespace.ruby",
              ],
              settings: {
                foreground: "var(--theme-syntax-type)",
              },
            },
            {
              scope: [
                "keyword.control",
                "source.cpp keyword.operator.new",
                "keyword.operator.delete",
                "keyword.other.using",
                "keyword.other.directive.using",
                "keyword.other.operator",
                "entity.name.operator",
              ],
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: [
                "variable",
                "meta.definition.variable.name",
                "support.variable",
                "entity.name.variable",
                "constant.other.placeholder",
              ],
              settings: {
                foreground: "var(--theme-syntax-variable)",
              },
            },
            {
              scope: ["variable.other.constant", "variable.other.enummember"],
              settings: {
                foreground: "var(--theme-syntax-variable)",
              },
            },
            {
              scope: ["meta.object-literal.key"],
              settings: {
                foreground: "var(--theme-syntax-variable)",
              },
            },
            {
              scope: [
                "support.constant.property-value",
                "support.constant.font-name",
                "support.constant.media-type",
                "support.constant.media",
                "constant.other.color.rgb-value",
                "constant.other.rgb-value",
                "support.constant.color",
              ],
              settings: {
                foreground: "var(--theme-syntax-string)",
              },
            },
            {
              scope: [
                "punctuation.definition.group.regexp",
                "punctuation.definition.group.assertion.regexp",
                "punctuation.definition.character-class.regexp",
                "punctuation.character.set.begin.regexp",
                "punctuation.character.set.end.regexp",
                "keyword.operator.negation.regexp",
                "support.other.parenthesis.regexp",
              ],
              settings: {
                foreground: "var(--theme-syntax-string)",
              },
            },
            {
              scope: [
                "constant.character.character-class.regexp",
                "constant.other.character-class.set.regexp",
                "constant.other.character-class.regexp",
                "constant.character.set.regexp",
              ],
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: ["keyword.operator.or.regexp", "keyword.control.anchor.regexp"],
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: "keyword.operator.quantifier.regexp",
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: ["constant.character", "constant.other.option"],
              settings: {
                foreground: "var(--theme-syntax-keyword)",
              },
            },
            {
              scope: "constant.character.escape",
              settings: {
                foreground: "var(--theme-syntax-operator)",
              },
            },
            {
              scope: "entity.name.label",
              settings: {
                foreground: "var(--theme-text-muted)",
              },
            },
          ],
          type: "dark",
        },
        transformers: [transformerUnifiedDiff(), transformerDiffGroups()],
      })) as string
    },
  )

  onMount(() => {
    if (!container) return

    let ticking = false
    const onScroll = () => {
      if (!container) return
      if (ctx.file.active()?.path !== local.path) return
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        ctx.file.scroll(local.path, container!.scrollTop)
      })
    }

    const onSelectionChange = () => {
      if (!container) return
      if (isProgrammaticSelection) return
      if (ctx.file.active()?.path !== local.path) return
      const d = getSelectionInContainer(container)
      if (!d) return
      const p = ctx.file.node(local.path)?.selection
      if (p && p.startLine === d.sl && p.endLine === d.el && p.startChar === d.sch && p.endChar === d.ech) return
      ctx.file.select(local.path, { startLine: d.sl, startChar: d.sch, endLine: d.el, endChar: d.ech })
    }

    const MOD = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform) ? "Meta" : "Control"
    const onKeyDown = (e: KeyboardEvent) => {
      if (ctx.file.active()?.path !== local.path) return
      const ae = document.activeElement as HTMLElement | undefined
      const tag = (ae?.tagName || "").toLowerCase()
      const inputFocused = !!ae && (tag === "input" || tag === "textarea" || ae.isContentEditable)
      if (inputFocused) return
      if (e.getModifierState(MOD) && e.key.toLowerCase() === "a") {
        e.preventDefault()
        if (!container) return
        const element = container.querySelector("code") as HTMLElement | undefined
        if (!element) return
        const lines = Array.from(element.querySelectorAll(".line"))
        if (!lines.length) return
        const r = document.createRange()
        const last = lines[lines.length - 1]
        r.selectNodeContents(last)
        const lastLen = r.toString().length
        ctx.file.select(local.path, { startLine: 1, startChar: 0, endLine: lines.length, endChar: lastLen })
      }
    }

    container.addEventListener("scroll", onScroll)
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("keydown", onKeyDown)

    onCleanup(() => {
      container?.removeEventListener("scroll", onScroll)
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  // Restore scroll position from store when content is ready
  createEffect(() => {
    const content = html()
    if (!container || !content) return
    const top = ctx.file.node(local.path)?.scrollTop
    if (top !== undefined && container.scrollTop !== top) container.scrollTop = top
  })

  // Sync selection from store -> DOM
  createEffect(() => {
    const content = html()
    if (!container || !content) return
    if (ctx.file.active()?.path !== local.path) return
    const codeEl = container.querySelector("code") as HTMLElement | undefined
    if (!codeEl) return
    const target = ctx.file.node(local.path)?.selection
    const current = getSelectionInContainer(container)
    const sel = window.getSelection()
    if (!sel) return
    if (!target) {
      if (current) {
        isProgrammaticSelection = true
        sel.removeAllRanges()
        queueMicrotask(() => {
          isProgrammaticSelection = false
        })
      }
      return
    }
    const matches = !!(
      current &&
      current.sl === target.startLine &&
      current.sch === target.startChar &&
      current.el === target.endLine &&
      current.ech === target.endChar
    )
    if (matches) return
    const lines = Array.from(codeEl.querySelectorAll(".line"))
    if (lines.length === 0) return
    let sIdx = Math.max(0, target.startLine - 1)
    let eIdx = Math.max(0, target.endLine - 1)
    let sChar = Math.max(0, target.startChar || 0)
    let eChar = Math.max(0, target.endChar || 0)
    if (sIdx > eIdx || (sIdx === eIdx && sChar > eChar)) {
      const ti = sIdx
      sIdx = eIdx
      eIdx = ti
      const tc = sChar
      sChar = eChar
      eChar = tc
    }
    if (eChar === 0 && eIdx > sIdx) {
      eIdx = eIdx - 1
      eChar = Number.POSITIVE_INFINITY
    }
    if (sIdx >= lines.length) return
    if (eIdx >= lines.length) eIdx = lines.length - 1
    const s = getNodeOffsetInLine(lines[sIdx], sChar) ?? { node: lines[sIdx], offset: 0 }
    const e = getNodeOffsetInLine(lines[eIdx], eChar) ?? { node: lines[eIdx], offset: lines[eIdx].childNodes.length }
    const range = document.createRange()
    range.setStart(s.node, s.offset)
    range.setEnd(e.node, e.offset)
    isProgrammaticSelection = true
    sel.removeAllRanges()
    sel.addRange(range)
    queueMicrotask(() => {
      isProgrammaticSelection = false
    })
  })

  // Build/toggle split layout and apply folding (both unified and split)
  createEffect(() => {
    const content = html()
    if (!container || !content) return
    const view = ctx.file.view(local.path)

    const pres = Array.from(container.querySelectorAll<HTMLPreElement>("pre"))
    if (pres.length === 0) return
    const originalPre = pres[0]

    const split = container.querySelector<HTMLElement>(".diff-split")
    if (view === "diff-split") {
      applySplitDiff(container)
      const next = container.querySelector<HTMLElement>(".diff-split")
      if (next) next.style.display = ""
      originalPre.style.display = "none"
    } else {
      if (split) split.style.display = "none"
      originalPre.style.display = ""
    }

    const expanded = ctx.file.folded(local.path)
    if (view === "diff-split") {
      const left = container.querySelector<HTMLElement>(".diff-split pre:nth-child(1) code")
      const right = container.querySelector<HTMLElement>(".diff-split pre:nth-child(2) code")
      if (left)
        applyDiffFolding(left, 3, { expanded, onExpand: (key) => ctx.file.unfold(local.path, key), side: "left" })
      if (right)
        applyDiffFolding(right, 3, { expanded, onExpand: (key) => ctx.file.unfold(local.path, key), side: "right" })
    } else {
      const code = container.querySelector<HTMLElement>("pre code")
      if (code)
        applyDiffFolding(code, 3, {
          expanded,
          onExpand: (key) => ctx.file.unfold(local.path, key),
        })
    }
  })

  // Highlight groups + scroll coupling
  const clearHighlights = () => {
    if (!container) return
    container.querySelectorAll<HTMLElement>(".diff-selected").forEach((el) => el.classList.remove("diff-selected"))
  }

  const applyHighlight = (idx: number, scroll?: boolean) => {
    if (!container) return
    const view = ctx.file.view(local.path)
    if (view === "raw") return

    clearHighlights()

    const nodes: HTMLElement[] = []
    if (view === "diff-split") {
      const left = container.querySelector<HTMLElement>(".diff-split pre:nth-child(1) code")
      const right = container.querySelector<HTMLElement>(".diff-split pre:nth-child(2) code")
      if (left)
        nodes.push(...Array.from(left.querySelectorAll<HTMLElement>(`[data-chgrp="${idx}"][data-diff="remove"]`)))
      if (right)
        nodes.push(...Array.from(right.querySelectorAll<HTMLElement>(`[data-chgrp="${idx}"][data-diff="add"]`)))
    } else {
      const code = container.querySelector<HTMLElement>("pre code")
      if (code) nodes.push(...Array.from(code.querySelectorAll<HTMLElement>(`[data-chgrp="${idx}"]`)))
    }

    for (const n of nodes) n.classList.add("diff-selected")
    if (scroll && nodes.length) nodes[0].scrollIntoView({ block: "center", behavior: "smooth" })
  }

  const countGroups = () => {
    if (!container) return 0
    const code = container.querySelector<HTMLElement>("pre code")
    if (!code) return 0
    const set = new Set<string>()
    for (const el of Array.from(code.querySelectorAll<HTMLElement>(".diff-line[data-chgrp]"))) {
      const v = el.getAttribute("data-chgrp")
      if (v != undefined) set.add(v)
    }
    return set.size
  }

  let lastIdx: number | undefined = undefined
  let lastView: string | undefined
  let lastContent: string | undefined
  let lastRawIdx: number | undefined = undefined
  createEffect(() => {
    const content = html()
    if (!container || !content) return
    const view = ctx.file.view(local.path)
    const raw = ctx.file.changeIndex(local.path)
    if (raw === undefined) return
    const total = countGroups()
    if (total <= 0) return
    const next = ((raw % total) + total) % total

    const navigated = lastRawIdx !== undefined && lastRawIdx !== raw

    if (next !== raw) {
      ctx.file.setChangeIndex(local.path, next)
      applyHighlight(next, true)
    } else {
      if (lastView !== view || lastContent !== content) applyHighlight(next)
      if ((lastIdx !== undefined && lastIdx !== next) || navigated) applyHighlight(next, true)
    }

    lastRawIdx = raw
    lastIdx = next
    lastView = view
    lastContent = content
  })

  return (
    <Suspense>
      <div
        ref={(el) => {
          container = el
        }}
        innerHTML={html()}
        class="
          font-mono text-xs tracking-wide overflow-y-auto no-scrollbar h-full
          [&]:[counter-reset:line]
          [&_pre]:focus-visible:outline-none
          [&_pre]:overflow-x-auto [&_pre]:no-scrollbar
          [&_code]:min-w-full [&_code]:inline-block [&_code]:pb-40
          [&_.tab]:relative
          [&_.tab::before]:content['⇥']
          [&_.tab::before]:absolute
          [&_.tab::before]:opacity-0
          [&_.space]:relative
          [&_.space::before]:content-['·']
          [&_.space::before]:absolute
          [&_.space::before]:opacity-0
          [&_.line]:inline-block [&_.line]:w-full
          [&_.line]:hover:bg-background-element
          [&_.line::before]:sticky [&_.line::before]:left-0
          [&_.line::before]:w-12 [&_.line::before]:pr-4
          [&_.line::before]:z-10
          [&_.line::before]:bg-background-panel
          [&_.line::before]:text-text-muted/60
          [&_.line::before]:text-right [&_.line::before]:inline-block
          [&_.line::before]:select-none
          [&_.line::before]:[counter-increment:line]
          [&_.line::before]:content-[counter(line)]
          [&_code.code-diff_.line::before]:content-['']
          [&_code.code-diff_.line::before]:w-0
          [&_code.code-diff_.line::before]:pr-0
          [&_.diff-split_code.code-diff::before]:w-10
          [&_.diff-split_.diff-newln]:left-0
          [&_.diff-oldln]:sticky [&_.diff-oldln]:left-0
          [&_.diff-oldln]:w-10 [&_.diff-oldln]:pr-2
          [&_.diff-oldln]:z-40
          [&_.diff-oldln]:text-text-muted/60
          [&_.diff-oldln]:text-right [&_.diff-oldln]:inline-block
          [&_.diff-oldln]:select-none
          [&_.diff-oldln]:bg-background-panel
          [&_.diff-newln]:sticky [&_.diff-newln]:left-10
          [&_.diff-newln]:w-10 [&_.diff-newln]:pr-2
          [&_.diff-newln]:z-40
          [&_.diff-newln]:text-text-muted/60
          [&_.diff-newln]:text-right [&_.diff-newln]:inline-block
          [&_.diff-newln]:select-none
          [&_.diff-newln]:bg-background-panel
          [&_.diff-add]:bg-success/20!
          [&_.diff-add.diff-selected]:bg-success/50!
          [&_.diff-add_.diff-oldln]:bg-success!
          [&_.diff-add_.diff-oldln]:text-background-panel!
          [&_.diff-add_.diff-newln]:bg-success!
          [&_.diff-add_.diff-newln]:text-background-panel!
          [&_.diff-remove]:bg-error/20!
          [&_.diff-remove.diff-selected]:bg-error/50!
          [&_.diff-remove_.diff-newln]:bg-error!
          [&_.diff-remove_.diff-newln]:text-background-panel!
          [&_.diff-remove_.diff-oldln]:bg-error!
          [&_.diff-remove_.diff-oldln]:text-background-panel!
          [&_.diff-sign]:inline-block [&_.diff-sign]:px-2 [&_.diff-sign]:select-none
          [&_.diff-blank]:bg-background-element
          [&_.diff-blank_.diff-oldln]:bg-background-element
          [&_.diff-blank_.diff-newln]:bg-background-element
          [&_.diff-collapsed]:block! [&_.diff-collapsed]:w-full [&_.diff-collapsed]:relative
          [&_.diff-collapsed]:cursor-pointer [&_.diff-collapsed]:select-none
          [&_.diff-collapsed]:bg-info/20 [&_.diff-collapsed]:hover:bg-info/40!
          [&_.diff-collapsed]:text-info/80 [&_.diff-collapsed]:hover:text-info
          [&_.diff-collapsed]:text-xs
          [&_.diff-collapsed_.diff-oldln]:bg-info!
          [&_.diff-collapsed_.diff-newln]:bg-info!
        "
        classList={{
          ...(local.classList || {}),
          [local.class ?? ""]: !!local.class,
        }}
        {...others}
      />
    </Suspense>
  )
}
