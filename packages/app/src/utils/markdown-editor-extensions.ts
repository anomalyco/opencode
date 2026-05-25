// FORK: .md 编辑增强 — Tier B 全套(列表续延 / 格式化快捷键 / 拖图 / 智能粘贴 / 折叠 / Ctrl+F)2026-05-05
// 给 file-tabs.tsx 编辑态调,集中所有 markdown-specific CodeMirror 6 扩展。

import type { Extension } from "@codemirror/state"
import { EditorState, Prec } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import type { Command } from "@codemirror/view"
import { HighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"
import { search, searchKeymap } from "@codemirror/search"
import { invoke } from "@tauri-apps/api/core"

// ============================================================
// 编辑态语义高亮(md-editing-iter-3,2026-05-25)
// 白领基线:GitHub Markdown CSS heading 比例(2/1.5/1.25/1/0.9/0.85)
//          + iA Writer 源模式标记符弱化(opacity 0.7)
// 跟 packages/ui/src/components/markdown.css 预览侧视觉统一
// ============================================================

export const markdownHighlightStyle = HighlightStyle.define([
  // heading 比例对齐 GitHub MD CSS / Notion
  { tag: t.heading1, fontSize: "2em",     fontWeight: "700", color: "var(--text-strong)" },
  { tag: t.heading2, fontSize: "1.5em",   fontWeight: "700", color: "var(--text-strong)" },
  { tag: t.heading3, fontSize: "1.25em",  fontWeight: "600", color: "var(--text-strong)" },
  { tag: t.heading4, fontSize: "1em",     fontWeight: "600", color: "var(--text-strong)" },
  { tag: t.heading5, fontSize: "0.9em",   fontWeight: "600", color: "var(--text-strong)" },
  { tag: t.heading6, fontSize: "0.85em",  fontWeight: "600", color: "var(--text-weak)" },
  // 行内样式
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  // monospace tag 没单独 spec — 因为 lezer-markdown 把 fenced code block 内容也标 monospace,
  // 加 chip 背景会让代码块每个 token 都套 chip(视觉灾难)。CodeMirror 整个编辑器已是
  // monospace 字体,源模式下 inline code 靠可见的反引号 ` ` 自识别(iA Writer / GitHub source
  // view / Notion 源数据都是此处理)。chip 视觉留给预览侧 markdown.css。
  { tag: t.quote, color: "var(--text-weak)", fontStyle: "italic" },
  // 链接:GitHub Primer / Notion / Linear / Slack 现代办公文档共识 — 唯一的 accent 蓝色
  // 跟 packages/ui/src/components/markdown.css:48 预览侧链接色统一(切预览不跳变)
  { tag: t.url, color: "var(--text-interactive-base)" },
  { tag: t.link, color: "var(--text-interactive-base)" },
  // list marker 不再染色 — 回归 monochrome,跟正文同色(Notion / GitHub Primer 同款)
  // 语法标记符温和弱化(# ** * ` 等)— iA Writer 同款 opacity 0.7
  { tag: t.processingInstruction, color: "var(--text-weak)", opacity: "0.7" },
  { tag: t.contentSeparator, color: "var(--text-weak)", opacity: "0.6" },
])

/**
 * markdown-only syntax highlight extension。
 * Prec.high 确保跟 code-mirror-view.tsx 全局 defaultHighlightStyle(fallback:true)
 * 共存时,markdown tag 走专属样式,代码块内部语言 fallback 到 default。
 */
export const markdownSyntaxHighlight = Prec.high(syntaxHighlighting(markdownHighlightStyle))

// ============================================================
// CodeMirror 内置 UI 短语翻译(@codemirror/search 走 phrase 取词)
// ============================================================

// FORK: export for unit tests(R5 测试纪律 / 关键模块清单)2026-05-07
export const PHRASES: Record<string, Record<string, string>> = {
  zh: {
    Find: "查找",
    Replace: "替换",
    next: "下一个",
    previous: "上一个",
    all: "全部",
    "match case": "区分大小写",
    regexp: "正则",
    "by word": "全词匹配",
    replace: "替换",
    "replace all": "全部替换",
    "Go to line": "跳转到行",
  },
  zht: {
    Find: "搜尋",
    Replace: "取代",
    next: "下一個",
    previous: "上一個",
    all: "全部",
    "match case": "區分大小寫",
    regexp: "正則",
    "by word": "全詞匹配",
    replace: "取代",
    "replace all": "全部取代",
    "Go to line": "跳轉到行",
  },
}

// ============================================================
// 列表续延(普通 - / 编号 1. / 任务 - [ ])+ 块引用 > 续延
// ============================================================

// FORK: export for unit tests 2026-05-07
export const LIST_PATTERNS = [
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
// FORK: export for unit tests(D3) 2026-05-07
export const continueListCommand: Command = (view) => {
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

// FORK: export for unit tests(D3) 2026-05-07
export const toggleBoldCommand = makeWrapCommand("**", "**")
export const toggleItalicCommand = makeWrapCommand("_", "_")

/** Ctrl+K:[选中](|) 光标进 url 区 */
// FORK: export for unit tests(D3) 2026-05-07
export const insertLinkCommand: Command = (view) => {
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

// 允许 [], [ ], [x], [X] 全部形态(空括号当未勾选处理)
// FORK: export for unit tests 2026-05-07
export const TASK_PATTERN = /^(\s*[-*+]\s+\[)( |x|X)?(\]\s*.*)$/

// FORK: export for unit tests(D3) 2026-05-07
export const toggleTaskCheckCommand: Command = (view) => {
  const sel = view.state.selection.main
  const line = view.state.doc.lineAt(sel.from)
  const m = TASK_PATTERN.exec(line.text)
  if (!m) return false
  const cur = m[2] ?? ""
  // x/X → 切回 " ";空 / " " → 切到 "x"
  const next = cur.toLowerCase() === "x" ? " " : "x"
  const newLine = m[1] + next + m[3]
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: newLine },
    // 光标位置不变(注意:若原本空 [],新行多了 1 字符,要补位)
    selection: { anchor: sel.from + (newLine.length - line.text.length) },
  })
  return true
}

// ============================================================
// 表格 Tab 跳格 — 简化版:跳到下个 `|`;末尾让 Tab 默认走
// ============================================================

// FORK: export for unit tests(D3) 2026-05-07
export const tableTabCommand: Command = (view) => {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const line = view.state.doc.lineAt(sel.from)
  // 必须是 markdown 表格行(含至少一个 |)
  if (!line.text.includes("|")) return false
  const fromInLine = sel.from - line.from

  // Case A:同行还有下个 `|` → 跳到下个 cell
  const nextPipe = line.text.indexOf("|", fromInLine)
  if (nextPipe >= 0) {
    let target = nextPipe + 1
    while (target < line.text.length && line.text[target] === " ") target++
    if (target < line.text.length && line.text[target] !== "|") {
      view.dispatch({
        selection: { anchor: line.from + target },
        scrollIntoView: true,
      })
      return true
    }
  }

  // Case B:本行末尾 → 下一行第一个 cell(若也是表格)
  if (line.number < view.state.doc.lines) {
    const next = view.state.doc.line(line.number + 1)
    if (next.text.includes("|")) {
      // 跳过 leading space + 首个 `|` + space
      let t = 0
      while (t < next.text.length && next.text[t] === " ") t++
      if (next.text[t] === "|") t++
      while (t < next.text.length && next.text[t] === " ") t++
      if (t < next.text.length && next.text[t] !== "|") {
        view.dispatch({
          selection: { anchor: next.from + t },
          scrollIntoView: true,
        })
        return true
      }
    }
    // Case C:在表格最末行末尾,下一行非表格 → 跳出表格到下一行开头
    view.dispatch({
      selection: { anchor: next.from },
      scrollIntoView: true,
    })
    return true
  }
  // 文档最末行,无下一行可跳 → 让默认 Tab 走
  return false
}

// ============================================================
// 智能 URL 粘贴 — 选区非空 + 粘贴是 URL → 改写 [选中](URL)
// ============================================================

// FORK: export for unit tests 2026-05-07
export const URL_PATTERN = /^https?:\/\/\S+$/

// FORK: export for unit tests(D3) 2026-05-07
export function handlePasteHook(view: EditorView, event: ClipboardEvent): boolean {
  const sel = view.state.selection.main
  if (sel.empty) return false // 没选区,默认粘贴
  // 优先 text/plain,没有再试 text/uri-list(浏览器地址栏 / Office 链接 fallback)
  const cd = event.clipboardData
  let text = cd?.getData("text/plain")?.trim() ?? ""
  if (!text) text = cd?.getData("text/uri-list")?.trim() ?? ""
  // uri-list 可能多行,取第一个
  if (text.includes("\n")) text = text.split("\n").find((l) => !l.startsWith("#"))?.trim() ?? ""
  if (!URL_PATTERN.test(text)) return false
  event.preventDefault()
  event.stopPropagation()
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

// FORK: export for unit tests 2026-05-07
export const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

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

// FORK: export for unit tests 2026-05-07
export function timestampName(originalName: string): string {
  const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".") + 1) : "png"
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+$/, "")
  return `pasted-${ts}.${ext}`
}

/** 计算 .md 文件相对路径所在目录的"上级数"— 用于拼 `../` 跳到 root */
// FORK: export for unit tests 2026-05-07
export function depthOf(filePathRel: string | undefined): number {
  if (!filePathRel) return 0
  // 规整成 forward-slash + 去前导/末尾 /
  const norm = filePathRel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  const parts = norm.split("/").filter(Boolean)
  // 去掉最后一段(文件名)
  return Math.max(0, parts.length - 1)
}

async function handleImageDrop(opts: ImageOpts, view: EditorView, files: FileList): Promise<boolean> {
  const root = opts.projectRoot
  if (!root) return false

  // 取所有 image/* 文件
  const images: File[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i)
    if (f && f.type.startsWith("image/")) images.push(f)
  }
  if (images.length === 0) return false

  // 集中放 <root>/Attachments/
  const attachDirAbs = `${root.replace(/\\/g, "/")}/Attachments`
  // 引用相对路径前缀:.md 在 root 下几层就 `../` 几次
  const ups = "../".repeat(depthOf(opts.filePathRel))

  const insertions: string[] = []
  for (const file of images) {
    try {
      const base64 = await readFileAsBase64(file)
      const filename = file.name && /\.[a-z0-9]+$/i.test(file.name) ? file.name : timestampName(file.name || "image.png")
      const safeName = `pasted-${Date.now()}-${filename}`.replace(/[<>:"|?*]/g, "_")
      const targetAbs = `${attachDirAbs}/${safeName}`
      await invoke("write_binary_file_absolute_base64", {
        path: targetAbs,
        base64Content: base64,
      })
      insertions.push(`![](${ups}Attachments/${safeName})`)
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
  projectRoot?: string // sdk.directory(绝对路径)
  filePathRel?: string // 当前 .md 相对 projectRoot 的路径,用来算 `../` 数
  locale?: string // app locale,用来翻译 CM 搜索面板("zh" / "zht" / "en" / ...)
}

// ============================================================
// 主入口 — 集合所有扩展
// ============================================================

export function markdownEditorExtensions(opts: ImageOpts = {}): Extension[] {
  const phrases = opts.locale ? PHRASES[opts.locale] : undefined
  return [
    // md-editing-iter-3:markdown 专属语义高亮(GitHub MD CSS heading 比例 + iA Writer 标记符弱化)
    // Prec.high 在 code-mirror-view.tsx 的 defaultHighlightStyle(fallback)之前匹配 md tag
    markdownSyntaxHighlight,
    // Heading 折叠 + 折叠键盘(默认 Ctrl+Shift+[/])
    foldGutter(),
    keymap.of(foldKeymap),
    // 搜索面板按 app locale 翻译(用 phrases facet 走 highest 优先,不命中 locale 退英文)
    ...(phrases ? [Prec.highest(EditorState.phrases.of(phrases))] : []),
    // 搜索/替换(Ctrl+F / Ctrl+H 完整面板)— 顶部悬浮 + highest 防全局 Ctrl+F 抢先
    search({ top: true }),
    Prec.highest(keymap.of(searchKeymap)),
    // 自家命令也走 highest:Tab / Enter / Mod-* 必须比 default keymap (含 indentWithTab) 优先
    Prec.highest(
      keymap.of([
        { key: "Enter", run: continueListCommand },
        { key: "Mod-b", run: toggleBoldCommand },
        { key: "Mod-i", run: toggleItalicCommand },
        { key: "Mod-k", run: insertLinkCommand },
        { key: "Mod-Enter", run: toggleTaskCheckCommand },
        { key: "Tab", run: tableTabCommand },
      ]),
    ),
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
        // Case A:文件树内部拖图 — 直接引用,不复制
        const ftPlain = event.dataTransfer?.getData("text/plain") ?? ""
        if (ftPlain.startsWith("file:")) {
          const relRaw = ftPlain.slice(5).replace(/\\/g, "/").replace(/^\/+/, "")
          if (IMAGE_EXT_PATTERN.test(relRaw)) {
            event.preventDefault()
            const ups = "../".repeat(depthOf(opts.filePathRel))
            const ref = `![](${ups}${relRaw})`
            const sel = view.state.selection.main
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: ref },
              selection: { anchor: sel.from + ref.length },
            })
            return true
          }
        }
        // Case B:OS 文件管理器拖入 — 复制到 Attachments/
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
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
