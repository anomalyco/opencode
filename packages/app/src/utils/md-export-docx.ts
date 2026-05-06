// [fork-only] .md 导出 Word(docx)— @jinzhongjia/markdown-docx + 走 platform 抽象
// [feat: md-export-pdf-word] 2026-05-05
//
// 选 @jinzhongjia/markdown-docx@1.0.4 的理由:
// - PoC 实测 v9 综合最优:Consolas + 灰底 + syntax 高亮 + 紧凑行距 + 整框边线 + 中文 — 全过
// - 比 turbodocx 强(后者代码块视觉根本问题不可解决)
// - 库内置 200+ 语言 syntax 高亮(默认 github-light 主题)
// - 库基于成熟的 docx@9.x(5k stars 主流)

import markdownDocx, { Packer, styles } from "@jinzhongjia/markdown-docx"
import { invoke } from "@tauri-apps/api/core"
import { showToast } from "@opencode-ai/ui/toast"
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate"
import { resolveAbsolute } from "@/utils/local-asset"

// FORK: monkey-patch 关代码块段间分隔线 — 库 default 把 between 边框设成跟 top 一样,
// 导致每段画线;改 none 让段间只是普通行距 2026-05-05
// 用 any cast 绕过库类型 readonly
;(styles as any).markdown.code.paragraph.border.between = { style: "none", size: 0 }

// FORK: A1 — 代码块切分根治 2026-05-06
// 根因:库每行代码生成 1 个 <w:p>,首段 pBdr=[top,l,r] / 中段 [l,r] / 尾段 [bottom,l,r]。
// WPS 渲染时按"边框集合相同才合并 box"判断 — 首尾段集合不同,被切成 3+ 个独立 box。
// 解:post-process docx zip,把每组连续 MdCode 段合并成 1 个 <w:p>,行间用 <w:br/>,
//    pBdr 改成完整四边 — 单段单 box,绝对不切。
const FULL_BORDER =
  `<w:pBdr>` +
  `<w:top w:val="single" w:color="E1E4E8" w:sz="1" w:space="8"/>` +
  `<w:left w:val="single" w:color="E1E4E8" w:sz="1" w:space="8"/>` +
  `<w:bottom w:val="single" w:color="E1E4E8" w:sz="1" w:space="8"/>` +
  `<w:right w:val="single" w:color="E1E4E8" w:sz="1" w:space="8"/>` +
  `</w:pBdr>`

function mergeCodeBlockParagraphs(docXml: string): string {
  const pPattern = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
  const paragraphs = [...docXml.matchAll(pPattern)]
  if (paragraphs.length === 0) return docXml

  // 注:用段落级 pStyle 精确匹配,不能用 includes("w:val=\"MdCode\"") —
  // 因为 inline code(反引号)在 OOXML 里是 <w:rStyle w:val="MdCode"/>(字符样式),
  // 含 inline code 的列表项 / 段落会被误判成代码块段并被错误合并。
  const isCode = paragraphs.map((m) => {
    const pPr = m[0].match(/<w:pPr>[\s\S]*?<\/w:pPr>/)
    return pPr ? /<w:pStyle\s+w:val="MdCode"/.test(pPr[0]) : false
  })
  const groups: Array<[number, number]> = []
  let i = 0
  while (i < isCode.length) {
    if (isCode[i]) {
      let j = i
      while (j < isCode.length && isCode[j]) j++
      if (j - i >= 2) groups.push([i, j])
      i = j
    } else i++
  }
  if (groups.length === 0) return docXml

  let result = docXml
  for (let g = groups.length - 1; g >= 0; g--) {
    const [start, end] = groups[g]
    const segs = paragraphs.slice(start, end).map((m) => m[0])

    const firstPPrMatch = segs[0].match(/<w:pPr>[\s\S]*?<\/w:pPr>/)
    if (!firstPPrMatch) continue
    let mergedPPr = firstPPrMatch[0]

    if (mergedPPr.includes("<w:pBdr>")) {
      mergedPPr = mergedPPr.replace(/<w:pBdr>[\s\S]*?<\/w:pBdr>/, FULL_BORDER)
    } else {
      mergedPPr = mergedPPr.replace("<w:pStyle", FULL_BORDER + "<w:pStyle")
    }
    mergedPPr = mergedPPr
      .replace(/(<w:spacing[^/]*?)w:before="\d+"/g, '$1w:before="0"')
      .replace(/(<w:spacing[^/]*?)w:after="\d+"/g, '$1w:after="0"')

    const mergedRuns = segs
      .map((seg) => [...seg.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].map((m) => m[0]).join(""))
      .join('<w:r><w:br/></w:r>')

    const mergedP = `<w:p>${mergedPPr}${mergedRuns}</w:p>`

    const replaceStart = paragraphs[start].index!
    const lastSeg = paragraphs[end - 1]
    const replaceEnd = lastSeg.index! + lastSeg[0].length
    result = result.slice(0, replaceStart) + mergedP + result.slice(replaceEnd)
  }
  return result
}

/** base64 → Uint8Array(浏览器 atob)*/
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Uint8Array → base64(分块避免 String.fromCharCode 栈溢出)*/
function bytesToBase64(bytes: Uint8Array): string {
  let bstr = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bstr += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bstr)
}

// FORK: B1+ — emoji & 普通 unicode 符号正确渲染 2026-05-06
// 老方案(已废弃):把 emoji / 箭头 / ✓✗ 全替换成 ASCII 文字 — 但 ↓→"v" 误像字母,emoji→[TARGET] 又丑
// 新方案:保留原 unicode 字符,post-process 时把含 emoji 的 run 切分成多段,emoji 段 rFonts 改 emoji 字体
//        让 Word 直接渲染彩色 emoji。箭头 / ✓✗ 是普通 unicode,默认字体支持,不动。
const EMOJI_REGEX = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u
// emoji 字体优先级:Win 内置 Segoe UI Emoji,Mac 找不到时自动 fallback 到 Apple Color Emoji
const EMOJI_RFONTS =
  '<w:rFonts w:ascii="Segoe UI Emoji" w:hAnsi="Segoe UI Emoji" w:cs="Segoe UI Emoji" w:eastAsia="Segoe UI Emoji"/>'

/** 把含 emoji 的 run 按"emoji vs 非 emoji"切分,emoji 段单独成 run + emoji 字体覆盖 */
function splitRunsForEmoji(docXml: string): string {
  return docXml.replace(/(<w:r\b[^>]*>)([\s\S]*?)(<\/w:r>)/g, (full, open, inner, close) => {
    const tMatch = inner.match(/(<w:t[^>]*>)([\s\S]*?)<\/w:t>/)
    if (!tMatch) return full
    const text = tMatch[2]
    if (!EMOJI_REGEX.test(text)) return full

    const rPrMatch = inner.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
    const rPr = rPrMatch ? rPrMatch[0] : ""

    // 按 codepoint 遍历(自动处理 surrogate pair),分组成 [{t,e}] 序列
    const segments: Array<{ t: string; e: boolean }> = []
    let buf = ""
    let bufIsE: boolean | null = null
    for (const ch of text) {
      const isE = EMOJI_REGEX.test(ch)
      if (bufIsE === null) {
        buf = ch
        bufIsE = isE
      } else if (isE === bufIsE) {
        buf += ch
      } else {
        segments.push({ t: buf, e: bufIsE })
        buf = ch
        bufIsE = isE
      }
    }
    if (buf) segments.push({ t: buf, e: bufIsE! })

    const emojiRPr = rPr
      ? rPr.includes("<w:rFonts")
        ? rPr.replace(/<w:rFonts\b[^/]*\/>/, EMOJI_RFONTS)
        : rPr.replace("<w:rPr>", `<w:rPr>${EMOJI_RFONTS}`)
      : `<w:rPr>${EMOJI_RFONTS}</w:rPr>`

    return segments
      .map((s) => `${open}${s.e ? emojiRPr : rPr}<w:t xml:space="preserve">${s.t}</w:t>${close}`)
      .join("")
  })
}

// FORK: Mermaid SVG → PNG (A2) — 库不渲染 mermaid,会出 ```mermaid 源码块
// 改:从 viewer DOM 拿已渲染的 SVG → canvas 转 PNG dataURL → 替换 markdown 块为 ![](dataurl)
// viewer 选择器:.markdown-mermaid-rendered(packages/ui/src/components/markdown.tsx:292)
// 2026-05-06

/** clone SVG 后把 foreignObject 替换成 SVG text — viewer 显示用 HTML labels(美观),
 *  导出用 SVG text(WKWebView 转 image 时 foreignObject 会触发 tainted canvas / "operation is insecure")。
 *  保留 viewer 显示效果不变,只对导出 clone 做替换。
 */
function patchForeignObjects(svgEl: SVGElement): void {
  const fos = Array.from(svgEl.querySelectorAll("foreignObject"))
  for (const fo of fos) {
    const x = parseFloat(fo.getAttribute("x") || "0")
    const y = parseFloat(fo.getAttribute("y") || "0")
    const width = parseFloat(fo.getAttribute("width") || "0")
    const height = parseFloat(fo.getAttribute("height") || "0")
    // 多行文字按 div / span / br 拆;最简取 textContent split by \n,每行一个 <tspan>
    const raw = (fo.textContent || "").replace(/ /g, " ").trim()
    if (!raw) {
      fo.remove()
      continue
    }
    const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const NS = "http://www.w3.org/2000/svg"
    const textEl = document.createElementNS(NS, "text")
    const cx = x + width / 2
    const cy = y + height / 2
    textEl.setAttribute("x", String(cx))
    textEl.setAttribute("y", String(cy))
    textEl.setAttribute("text-anchor", "middle")
    textEl.setAttribute("dominant-baseline", "middle")
    textEl.setAttribute("font-family", "sans-serif")
    textEl.setAttribute("font-size", "14")
    textEl.setAttribute("fill", "#333")
    if (lines.length === 1) {
      textEl.textContent = lines[0]
    } else {
      // 多行:首行偏移到 (lines.length-1)/2 * 行高之上,各 tspan 用 dy 推进
      const lineHeight = 16
      const totalH = (lines.length - 1) * lineHeight
      lines.forEach((line, i) => {
        const tspan = document.createElementNS(NS, "tspan")
        tspan.setAttribute("x", String(cx))
        tspan.setAttribute("dy", i === 0 ? String(-totalH / 2) : String(lineHeight))
        tspan.textContent = line
        textEl.appendChild(tspan)
      })
    }
    fo.parentNode?.replaceChild(textEl, fo)
  }
}

/** 把 SVG 元素转 PNG dataURL(3x scale,白底) — 3x 在 retina + 200% Word 缩放下仍清晰,文件 ~2.25x */
async function svgToPngDataUrl(svgEl: SVGElement, scale = 3): Promise<string> {
  // clone 一份避免破坏 viewer 显示
  const cloned = svgEl.cloneNode(true) as SVGElement
  patchForeignObjects(cloned)
  // 序列化 svg,确保 xmlns(防 Image 加载失败)
  let svgString = new XMLSerializer().serializeToString(cloned)
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
 *
 * FORK: 等待 + 重试逻辑(2026-05-06)— 若 user 在 viewer 还没把所有 mermaid 渲染完时就点导出,
 *       原版直接抓 DOM 会少图(典型现象:第 1 个 mermaid 大,渲染慢,被错过 → 源码留为代码块)。
 *       现在轮询直到节点数匹配 markdown 中 ```mermaid 块数 + 每个都有 svg,最多等 5 秒。
 */
async function inlineMermaidPngs(md: string, viewerEl?: HTMLElement): Promise<string> {
  if (!viewerEl) return md
  const expectedCount = (md.match(/```mermaid\n[\s\S]*?\n```/g) ?? []).length
  if (expectedCount === 0) return md // markdown 里没 mermaid

  // 轮询等所有 mermaid 渲染完成
  const deadline = Date.now() + 5000
  let renderedNodes: HTMLElement[] = []
  while (true) {
    renderedNodes = Array.from(viewerEl.querySelectorAll<HTMLElement>(".markdown-mermaid-rendered"))
    const allReady =
      renderedNodes.length === expectedCount && renderedNodes.every((n) => n.querySelector("svg"))
    if (allReady || Date.now() >= deadline) break
    await new Promise((r) => setTimeout(r, 150))
  }

  // 提前转所有 SVG → PNG(顺序遍历,FAIL → null,后续保留源码)
  const pngs: Array<string | null> = []
  for (let i = 0; i < renderedNodes.length; i++) {
    const node = renderedNodes[i]
    const svg = node.querySelector("svg")
    if (!svg) {
      pngs.push(null)
      continue
    }
    try {
      const png = await svgToPngDataUrl(svg as SVGElement)
      pngs.push(png)
    } catch {
      pngs.push(null)
    }
  }

  // 按顺序替换 ```mermaid ... ``` 块。pngs 不足时(比如某个永远没渲染),后续块保留源码。
  let idx = 0
  return md.replace(/```mermaid\n[\s\S]*?\n```/g, (matched) => {
    const png = pngs[idx++]
    if (!png) return matched
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

    // 2. 预处理 markdown:Mermaid SVG → PNG + 本地图片 base64 嵌入
    //    (emoji 不再做文本替换 — 改用 docx XML 层面的 splitRunsForEmoji,见步骤 4)
    let processedMd = await inlineMermaidPngs(opts.markdownText, opts.viewerEl)
    processedMd = await inlineLocalImages(processedMd, opts.mdFileDir)

    // 3. markdown → docx(库内部 marked + docx@9.x 构造,带 syntax 高亮)
    const doc = await markdownDocx(processedMd, {
      codeHighlight: {
        enabled: true,
        theme: "github-light", // 浅色主题更适合 Word 打印
      },
    })

    // 4. 序列化 → 双重 post-process(合并代码块段 + emoji run 切分)→ 写盘
    // 注:Packer.toBuffer() Node-only,浏览器报"nodebuffer is not supported";用 toBase64String + atob/btoa 转字节
    const base64Original = await Packer.toBase64String(doc)
    const zipObj = unzipSync(base64ToBytes(base64Original))
    let docXml = strFromU8(zipObj["word/document.xml"])
    docXml = mergeCodeBlockParagraphs(docXml)
    docXml = splitRunsForEmoji(docXml)
    zipObj["word/document.xml"] = strToU8(docXml)
    const base64 = bytesToBase64(zipSync(zipObj))
    // allowOverwrite=true:save dialog 已让用户确认替换,后端不再拦截 already_exists
    await invoke("write_binary_file_absolute_base64", {
      path: filePath,
      base64Content: base64,
      allowOverwrite: true,
    })

    showToast({ variant: "success", title: opts.i18n.success })
  } catch (e) {
    // FORK: B2 — 错误友好化,把英文 raw error 关键字映射到中文友好描述,原 message 保留作 detail
    const raw = e instanceof Error ? e.message : String(e)
    showToast({
      variant: "error",
      title: opts.i18n.fail,
      description: friendlyError(raw),
    })
  }
}

/** 错误友好化:常见 Tauri / 库错误关键字 → 中文 */
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase()
  // 文件系统错误
  if (lower.includes("permission denied") || lower.includes("eacces") || lower.includes("eperm")) {
    return `保存路径无写入权限。请选其他位置或检查文件夹权限。\n[详细] ${raw}`
  }
  if (lower.includes("no space") || lower.includes("enospc") || lower.includes("disk full")) {
    return `磁盘空间不足。请清理磁盘后重试。\n[详细] ${raw}`
  }
  if (lower.includes("read-only") || lower.includes("erofs")) {
    return `保存目录为只读。请选可写位置。\n[详细] ${raw}`
  }
  if (lower.includes("path too long") || lower.includes("enametoolong")) {
    return `路径过长。请用更短的文件名或路径。\n[详细] ${raw}`
  }
  if (lower.includes("file too large") || lower.includes("emfile")) {
    return `文件过大,超出限制。\n[详细] ${raw}`
  }
  if (lower.includes("not found") || lower.includes("enoent")) {
    return `路径不存在。\n[详细] ${raw}`
  }
  // 库内部错误
  if (lower.includes("nodebuffer")) {
    return `内部转换错误(浏览器环境兼容)。请反馈开发者。\n[详细] ${raw}`
  }
  if (lower.includes("invalid markdown") || lower.includes("parse")) {
    return `markdown 语法解析失败。\n[详细] ${raw}`
  }
  // 兜底
  return raw
}
