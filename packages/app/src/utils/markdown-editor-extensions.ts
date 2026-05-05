// FORK: .md 编辑增强 — Tier B 全套(列表续延 / 格式化快捷键 / 拖图 / 智能粘贴 / 折叠 / Ctrl+F)2026-05-05
// 给 file-tabs.tsx 编辑态调,集中所有 markdown-specific CodeMirror 6 扩展。

import type { Extension } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import type { Command } from "@codemirror/view"
import { foldGutter, foldKeymap } from "@codemirror/language"
import { search, searchKeymap } from "@codemirror/search"
import { invoke } from "@tauri-apps/api/core"

// ============================================================
// 列表续延(普通 - / 编号 1. / 任务 - [ ])+ 块引用 > 续延
// ============================================================

const LIST_PATTERNS = [
  // task list:`  - [ ] 内容` 或 `  - [x] 内容`
  /^(\s*)([-*+])\s+(\[[ xX]\])\s*(.*)$/,
  // numbered:`  1. 内容`
  /^(\s*)(\d+)\.\s+(.*)$/,
  // plain bullet:`  - 内容`
  /^(\s*)([-*+])\s+(.*)$/,
  // blockquote:`> 内容` 或 `  > 内容`
  /^(\s*)(>\s+)(.*)$/,
]

/** Enter 智能续行:识别上一行 list/quote prefix 自动续;空 item 再 Enter 退出 */
const continueListCommand: Command = (view) => {
  const sel = view.state.selection.main
  if (!sel.empty) return false // 有选区时不拦截
  const line = view.state.doc.lineAt(sel.from)
  const text = line.text
  const cursorAtLineEnd = sel.from === line.to

  for (const pat of LIST_PATTERNS) {
    const m = pat.exec(text)
    if (!m) continue

    const indent = m[1]
    let prefix = ""
    let isEmpty = false

    if (pat === LIST_PATTERNS[0]) {
      // task list:- [ ] 内容
      const marker = m[2]
      const content = m[4]
      isEmpty = !content.trim()
      prefix = `${indent}${marker} [ ] `
    } else if (pat === LIST_PATTERNS[1]) {
      // numbered
      const num = parseInt(m[2], 10)
      const content = m[3]
      isEmpty = !content.trim()
      prefix = `${indent}${num + 1}. `
    } else if (pat === LIST_PATTERNS[2]) {
      // plain bullet
      const marker = m[2]
      const content = m[3]
      isEmpty = !content.trim()
      prefix = `${indent}${marker} `
    } else if (pat === LIST_PATTERNS[3]) {
      // blockquote
      const content = m[3]
      isEmpty = !content.trim()
      prefix = `${indent}${m[2]}` // m[2] = "> " 或 "> "(已含空格)
    }

    // 光标必须在行尾(不在中间)才续行;否则让默认 Enter 处理
    if (!cursorAtLineEnd) return false

    if (isEmpty) {
      // 空 item:替换整行为空,光标到该位置 → 退出列表
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from },
        scrollIntoView: true,
      })
      return true
    }

    // 续行
    view.dispatch({
      changes: { from: sel.from, insert: "\n" + prefix },
      selection: { anchor: sel.from + 1 + prefix.length },
      scrollIntoView: true,
    })
    return true
  }
  return false // 不在任何 list/quote 行 → 默认 Enter
}

// ============================================================
// 格式化快捷键 — Ctrl+B 粗体 / Ctrl+I 斜体 / Ctrl+K 链接
// ============================================================

function makeWrapCommand(left: string, right: string): Command {
  return (view) => {
    const sel = view.state.selection.main
    const text = view.state.sliceDoc(sel.from, sel.to)
    const wrapped = `${left}${text}${right}`
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: wrapped },
      // 选区为空 → 光标置中(left 长度后);有选区 → 选中包后内容
      selection: sel.empty
        ? { anchor: sel.from + left.length }
        : { anchor: sel.from + left.length, head: sel.from + left.length + text.length },
    })
    return true
  }
}

const toggleBoldCommand = makeWrapCommand("**", "**")
const toggleItalicCommand = makeWrapCommand("_", "_")

/** Ctrl+K:[选中](|) 光标进 url 区 */
const insertLinkCommand: Command = (view) => {
  const sel = view.state.selection.main
  const text = view.state.sliceDoc(sel.from, sel.to)
  const wrapped = `[${text}]()`
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: wrapped },
    // 光标进入 () 中间
    selection: { anchor: sel.from + text.length + 3 },
  })
  return true
}

// ============================================================
// 任务列表 toggle Ctrl+Enter — [ ] ↔ [x]
// ============================================================

const TASK_PATTERN = /^(\s*[-*+]\s+\[)( |x|X)(\]\s.*)$/

const toggleTaskCheckCommand: Command = (view) => {
  const sel = view.state.selection.main
  const line = view.state.doc.lineAt(sel.from)
  const m = TASK_PATTERN.exec(line.text)
  if (!m) return false
  const next = m[2] === " " ? "x" : " "
  const newLine = m[1] + next + m[3]
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: newLine },
    selection: { anchor: sel.from }, // 光标位置不变
  })
  return true
}

// ============================================================
// 表格 Tab 跳格 — 简化版:跳到下个 `|`;末尾让 Tab 默认走
// ============================================================

const tableTabCommand: Command = (view) => {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const line = view.state.doc.lineAt(sel.from)
  // 必须是 markdown 表格行(含至少一个 |)
  if (!line.text.includes("|")) return false
  // 找下个 `|` 后位置
  const fromInLine = sel.from - line.from
  const nextPipe = line.text.indexOf("|", fromInLine)
  if (nextPipe < 0) return false
  // 跳到 `|` 之后第一个非空格位置
  let target = nextPipe + 1
  while (target < line.text.length && line.text[target] === " ") target++
  if (target >= line.text.length) return false
  view.dispatch({
    selection: { anchor: line.from + target },
    scrollIntoView: true,
  })
  return true
}

// ============================================================
// 智能 URL 粘贴 — 选区非空 + 粘贴是 URL → 改写 [选中](URL)
// ============================================================

const URL_PATTERN = /^(https?:\/\/[^\s]+)$/

function handlePasteHook(view: EditorView, event: ClipboardEvent): boolean {
  const sel = view.state.selection.main
  if (sel.empty) return false // 没选区,默认粘贴
  const text = event.clipboardData?.getData("text/plain")?.trim() ?? ""
  if (!URL_PATTERN.test(text)) return false // 不是 URL,默认粘贴
  // 是 URL 且有选区 → 改写
  event.preventDefault()
  const selected = view.state.sliceDoc(sel.from, sel.to)
  const wrapped = `[${selected}](${text})`
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: wrapped },
    selection: { anchor: sel.from + wrapped.length },
  })
  return true
}

// ============================================================
// 拖图 / 截图粘贴 — 自动写文件 + 插入 ![](path)
// ============================================================

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") return reject(new Error("FileReader returned non-string"))
      const idx = result.indexOf(",")
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"))
    reader.readAsDataURL(file)
  })
}

function timestampName(originalName: string): string {
  const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".") + 1) : "png"
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+$/, "")
  return `pasted-${ts}.${ext}`
}

async function handleImageDrop(opts: ImageOpts, view: EditorView, files: FileList): Promise<boolean> {
  const fileDir = opts.fileDir
  if (!fileDir) return false

  // 取所有 image/* 文件
  const images: File[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i)
    if (f && f.type.startsWith("image/")) images.push(f)
  }
  if (images.length === 0) return false

  const insertions: string[] = []
  for (const file of images) {
    try {
      const base64 = await readFileAsBase64(file)
      const filename = file.name && /\.[a-z0-9]+$/i.test(file.name) ? file.name : timestampName(file.name || "image.png")
      // 确保文件名唯一(避免覆盖)— 简单加时间戳
      const safeName = `pasted-${Date.now()}-${filename}`.replace(/[<>:"|?*]/g, "_")
      const targetAbs = `${fileDir}/${safeName}`
      await invoke("write_binary_file_absolute_base64", {
        path: targetAbs,
        base64Content: base64,
      })
      insertions.push(`![](${safeName})`)
    } catch (e) {
      console.error("[md-editor] image drop failed:", e)
    }
  }
  if (insertions.length === 0) return false

  const sel = view.state.selection.main
  const text = insertions.join("\n")
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + text.length },
  })
  return true
}

type ImageOpts = {
  fileDir?: string // 当前 .md 文件所在目录的绝对路径
}

// ============================================================
// 主入口 — 集合所有扩展
// ============================================================

export function markdownEditorExtensions(opts: ImageOpts = {}): Extension[] {
  return [
    // Heading 折叠 + 折叠键盘(默认 Ctrl+Shift+[/])
    foldGutter(),
    keymap.of(foldKeymap),
    // 搜索/替换(Ctrl+F / Ctrl+H 完整面板)
    search(),
    keymap.of(searchKeymap),
    // 自家命令优先于 default keymap
    keymap.of([
      { key: "Enter", run: continueListCommand },
      { key: "Mod-b", run: toggleBoldCommand },
      { key: "Mod-i", run: toggleItalicCommand },
      { key: "Mod-k", run: insertLinkCommand },
      { key: "Mod-Enter", run: toggleTaskCheckCommand },
      { key: "Tab", run: tableTabCommand },
    ]),
    // paste / drop handlers
    EditorView.domEventHandlers({
      paste(event, view) {
        // 1. 智能 URL 粘贴
        if (handlePasteHook(view, event)) return true
        // 2. 截图粘贴(剪贴板里有 image/* 文件)
        const items = event.clipboardData?.items
        if (!items) return false
        const files: File[] = []
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it.kind === "file" && it.type.startsWith("image/")) {
            const f = it.getAsFile()
            if (f) files.push(f)
          }
        }
        if (files.length === 0) return false
        // 构造伪 FileList
        const dt = new DataTransfer()
        for (const f of files) dt.items.add(f)
        event.preventDefault()
        void handleImageDrop(opts, view, dt.files)
        return true
      },
      drop(event, view) {
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        // 只处理 image/* 文件;非图给默认 drop 行为
        let hasImage = false
        for (let i = 0; i < files.length; i++) {
          if (files[i]?.type.startsWith("image/")) {
            hasImage = true
            break
          }
        }
        if (!hasImage) return false
        event.preventDefault()
        void handleImageDrop(opts, view, files)
        return true
      },
    }),
  ]
}
