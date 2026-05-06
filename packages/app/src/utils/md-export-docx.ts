// [fork-only] .md 导出 Word(docx)— @jinzhongjia/markdown-docx + 走 platform 抽象
// [feat: md-export-pdf-word] 2026-05-05
//
// 选 @jinzhongjia/markdown-docx@1.0.4 的理由:
// - PoC 实测 v9 综合最优:Consolas + 灰底 + syntax 高亮 + 紧凑行距 + 整框边线 + 中文 — 全过
// - 比 turbodocx 强(后者代码块视觉根本问题不可解决)
// - 库内置 200+ 语言 syntax 高亮(默认 github-light 主题)
// - 库基于成熟的 docx@9.x(5k stars 主流)
//
// 已知遗留(对 user 透明,已记需求池):
// - 代码块**空行段两侧仍有横线分隔**(库内部把空行当独立段落,top/bottom border 仍渲染)
// - between=none monkey-patch 解决了真代码行之间的横线,但空行段仍有

import markdownDocx, { Packer, styles } from "@jinzhongjia/markdown-docx"
import { invoke } from "@tauri-apps/api/core"
import { showToast } from "@opencode-ai/ui/toast"
import { resolveAbsolute } from "@/utils/local-asset"

// FORK: monkey-patch 关代码块段间分隔线 — 库 default 把 between 边框设成跟 top 一样,
// 导致每段画线;改 none 让段间只是普通行距 2026-05-05
// 用 any cast 绕过库类型 readonly
;(styles as any).markdown.code.paragraph.border.between = { style: "none", size: 0 }

// FORK: emoji 预处理(B1)— Word 默认字体不一定含 emoji glyphs,有些 emoji 渲染为方框 / 乱码
// 替换为文字符号(覆盖常用 ~30 个,其他 emoji 接受现状)2026-05-06
const EMOJI_MAP: Record<string, string> = {
  "📝": "[NOTE]",
  "📌": "[PIN]",
  "📍": "[LOC]",
  "📋": "[CLIPBOARD]",
  "📚": "[BOOKS]",
  "📖": "[BOOK]",
  "🚀": "[ROCKET]",
  "✅": "[OK]",
  "❌": "[X]",
  "⚠️": "[WARN]",
  "⚠": "[WARN]",
  "🔍": "[SEARCH]",
  "💡": "[IDEA]",
  "🔥": "[HOT]",
  "🎯": "[TARGET]",
  "🐛": "[BUG]",
  "🔧": "[FIX]",
  "⚡": "[FAST]",
  "🌟": "[STAR]",
  "⭐": "[STAR]",
  "🎉": "[PARTY]",
  "🤔": "[THINK]",
  "👀": "[EYES]",
  "✓": "[v]",
  "✗": "[x]",
  "→": "->",
  "←": "<-",
  "↑": "^",
  "↓": "v",
  "🔴": "[red]",
  "🟢": "[green]",
  "🟡": "[yellow]",
  "🔵": "[blue]",
  "💻": "[CODE]",
  "🛠️": "[TOOLS]",
  "🛠": "[TOOLS]",
  "📦": "[PACKAGE]",
  "🚧": "[CONSTRUCTION]",
  "🆕": "[NEW]",
  "❗": "[!]",
  "❓": "[?]",
  "ℹ️": "[INFO]",
  "ℹ": "[INFO]",
}

function preprocessMarkdown(md: string): string {
  let out = md
  for (const [emo, txt] of Object.entries(EMOJI_MAP)) {
    if (out.includes(emo)) {
      out = out.replaceAll(emo, txt)
    }
  }
  return out
}

// FORK: Mermaid SVG → PNG (A2) — 库不渲染 mermaid,会出 ```mermaid 源码块
// 改:从 viewer DOM 拿已渲染的 SVG → canvas 转 PNG dataURL → 替换 markdown 块为 ![](dataurl)
// viewer 选择器:.markdown-mermaid-rendered(packages/ui/src/components/markdown.tsx:292)
// 2026-05-06

/** 把 SVG 元素转 PNG dataURL(2x scale,白底) */
async function svgToPngDataUrl(svgEl: SVGElement, scale = 2): Promise<string> {
  // 序列化 svg,确保 xmlns(防 Image 加载失败)
  let svgString = new XMLSerializer().serializeToString(svgEl)
  if (!svgString.includes("xmlns=\"http://www.w3.org/2000/svg\"")) {
    svgString = svgString.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" })
  const url = URL.createObjectURL(blob)

  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = (e) => reject(new Error(`SVG load failed: ${e}`))
      img.src = url
    })

    // 优先用 svg 的 viewBox / width-height 属性,fallback 到 boundingRect / 默认 800x600
    const rect = svgEl.getBoundingClientRect()
    const w = Math.ceil(rect.width || 800)
    const h = Math.ceil(rect.height || 600)

    const canvas = document.createElement("canvas")
    canvas.width = w * scale
    canvas.height = h * scale
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    return canvas.toDataURL("image/png")
  } finally {
    URL.revokeObjectURL(url)
  }
}

// FORK: 本地图片 → base64 嵌入 (A5) — 库不解析相对路径,直接喂会 broken image
// 扫 markdown ![](path),读本地文件 → base64 + mime → 替换为 ![](data:...) 2026-05-06

const IMG_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
}

function mimeFromPath(p: string): string | null {
  const lower = p.toLowerCase()
  for (const [ext, mime] of Object.entries(IMG_MIME)) {
    if (lower.endsWith(ext)) return mime
  }
  return null
}

/** 把 markdown 里 ![](path) 的本地相对/绝对图替换为 base64 dataURL。
 * 跳过 http(s) / data / blob / 锚点等;读失败保留原 path(library 端会 broken,但不阻塞导出)
 */
async function inlineLocalImages(md: string, mdFileDir?: string): Promise<string> {
  if (!mdFileDir) return md
  // 匹配 ![alt](path "title"?) — title 可选
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g
  const matches: Array<{ full: string; alt: string; src: string; title?: string }> = []
  for (const m of md.matchAll(re)) {
    matches.push({ full: m[0], alt: m[1], src: m[2], title: m[3] })
  }
  if (matches.length === 0) return md

  // 并发读所有本地图
  const replacements = await Promise.all(
    matches.map(async (m) => {
      const src = m.src.trim()
      // 跳过外链 / data / blob / anchor / protocol
      if (/^(https?|data|blob|file|localasset):/i.test(src)) return null
      if (src.startsWith("//") || src.startsWith("#")) return null

      // 解 percent-encode(对齐 local-asset.ts:100 fix)
      let decoded = src
      try {
        decoded = decodeURIComponent(src)
      } catch {
        // ignore
      }
      const absPath = resolveAbsolute(mdFileDir, decoded)
      const mime = mimeFromPath(absPath)
      if (!mime) return null // 不识别后缀,跳过

      try {
        // root="" 让 PathBuf::from("").join(absPath) 直接返回 absPath
        const base64 = await invoke<string>("read_binary_file_base64", { root: "", path: absPath })
        const dataUrl = `data:${mime};base64,${base64}`
        const titlePart = m.title ? ` "${m.title}"` : ""
        return { full: m.full, replaced: `![${m.alt}](${dataUrl}${titlePart})` }
      } catch {
        return null // 读失败保留原 markdown
      }
    }),
  )

  let out = md
  for (const r of replacements) {
    if (!r) continue
    out = out.replace(r.full, r.replaced)
  }
  return out
}

/** 把 markdown 里的 ```mermaid 块替换成 viewer 已渲染的 SVG → PNG dataURL ![](...)
 * 顺序:按 viewer 内 .markdown-mermaid-rendered 顺序对应 markdown 内 mermaid 块顺序
 */
async function inlineMermaidPngs(md: string, viewerEl?: HTMLElement): Promise<string> {
  if (!viewerEl) return md
  const renderedNodes = Array.from(
    viewerEl.querySelectorAll<HTMLElement>(".markdown-mermaid-rendered"),
  )
  if (renderedNodes.length === 0) return md // viewer 里没渲染过 mermaid,markdown 里也无 ```mermaid

  // 提前转所有 SVG → PNG(并发)
  const pngs = await Promise.all(
    renderedNodes.map(async (node) => {
      const svg = node.querySelector("svg")
      if (!svg) return null
      try {
        return await svgToPngDataUrl(svg)
      } catch {
        return null
      }
    }),
  )

  // 按顺序替换 ```mermaid ... ``` 块
  let idx = 0
  return md.replace(/```mermaid\n[\s\S]*?\n```/g, (matched) => {
    const png = pngs[idx++]
    if (!png) return matched // 转换失败保留源码
    return `![Mermaid Diagram](${png})`
  })
}

export type ExportDocxI18n = {
  /** save 对话框标题 */
  title: string
  /** 成功 toast 文案 */
  success: string
  /** 失败 toast 文案 */
  fail: string
}

/** save 对话框函数签名,与 packages/app/src/context/platform.tsx saveFilePickerDialog 一致 */
export type SaveFilePickerFn = (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>

/** 把 markdown 原文导出为 .docx
 *
 * 调用方负责传入 platform.saveFilePickerDialog(viewer 菜单 callback 那一层注入)
 * 这样 helper 不直接依赖 @tauri-apps/plugin-dialog(packages/app 没装该 plugin)
 */
export const exportMdAsDocx = async (opts: {
  /** markdown 原文(viewer 渲染的源) */
  markdownText: string
  /** save 对话框默认文件名(不带后缀,如原 .md 文件名去掉 .md)*/
  defaultFileName: string
  /** Tauri save 对话框函数(调用方注入,通常是 platform.saveFilePickerDialog) */
  saveDialog: SaveFilePickerFn
  /** viewer 容器 DOM(可选)— 提供则从已渲染的 mermaid SVG 抽 PNG 嵌入,否则保留 ```mermaid 源码块 */
  viewerEl?: HTMLElement
  /** .md 文件所在绝对目录(可选)— 提供则把 ![](./img.png) 等本地图替换为 base64 dataURL */
  mdFileDir?: string
  i18n: ExportDocxI18n
}) => {
  let filePath: string | null = null
  try {
    // 1. 系统 save 对话框(经 platform 抽象)
    filePath = await opts.saveDialog({
      defaultPath: `${opts.defaultFileName}.docx`,
      title: opts.i18n.title,
    })
    if (!filePath) return // user 取消,静默退出

    // 2. 预处理 markdown:emoji 替换 + Mermaid SVG → PNG + 本地图片 base64 嵌入
    let processedMd = preprocessMarkdown(opts.markdownText)
    processedMd = await inlineMermaidPngs(processedMd, opts.viewerEl)
    processedMd = await inlineLocalImages(processedMd, opts.mdFileDir)

    // 3. markdown → docx(库内部 marked + docx@9.x 构造,带 syntax 高亮)
    const doc = await markdownDocx(processedMd, {
      codeHighlight: {
        enabled: true,
        theme: "github-light", // 浅色主题更适合 Word 打印
      },
    })

    // 4. 序列化为 base64 + 写盘(用 fork-only Tauri command 绕开二进制 IPC 限制)
    // 注:Packer.toBuffer() 是 Node-only,Tauri webview 浏览器环境会报"nodebuffer is not supported";
    //    Packer.toBase64String() 直接出 base64,既适配浏览器又省一步 buffer→base64 转换
    const base64 = await Packer.toBase64String(doc)
    await invoke("write_binary_file_absolute_base64", { path: filePath, base64Content: base64 })

    showToast({ variant: "success", title: opts.i18n.success })
  } catch (e) {
    showToast({
      variant: "error",
      title: opts.i18n.fail,
      description: e instanceof Error ? e.message : String(e),
    })
  }
}
