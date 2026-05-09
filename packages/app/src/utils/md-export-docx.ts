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

// FORK: monkey-patch 关 blockquote 默认斜体 — user 反馈引用字体不应统一斜体,只在原文 *italic* 标记时才斜
// (em token 单独走 attr.italics=true,与 style.run.italics default 无关,显式 italic 不受影响)
// 字色保持库默认(灰 #666666),user 反馈不动 2026-05-08
;(styles as any).markdown.blockquote.run.italics = false

// FORK: monkey-patch documentDefault 字号 + 行距用 Word default
// 库默认 size=24(12pt),Word default 是 22(11pt);行距 lineRule=auto 无 line 值,Word default 1.15
// user 反馈引用块字号偏大 + 行距偏紧,实际是全局 default 不对,改 documentDefault 全文受益 2026-05-08
;(styles as any).default.document.run.size = 22 // 11pt
;(styles as any).default.document.paragraph.spacing = { line: 276, lineRule: "auto" } // 1.15 倍行距

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

// FORK: export for unit tests(R5 测试纪律 / 关键模块清单)2026-05-07
export function mergeCodeBlockParagraphs(docXml: string): string {
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
// FORK: export for unit tests 2026-05-07
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Uint8Array → base64(分块避免 String.fromCharCode 栈溢出)*/
// FORK: export for unit tests 2026-05-07
export function bytesToBase64(bytes: Uint8Array): string {
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
// FORK: export for unit tests 2026-05-07
export function splitRunsForEmoji(docXml: string): string {
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

// FORK: 2026-05-08 — inline code 改底色(库 hardcode 加 underline 不带 background,见 dist:1006)
// 标识:rPr 含 <w:rStyle w:val="MdCode"/> 且含 <w:u .../>(代码块 run 没有 underline,以此区分)
// 操作:去 underline,加 <w:shd> 彩色背景(薄荷绿 #D4EDDA,比浅灰更醒目,user 反馈)
const INLINE_CODE_SHD = '<w:shd w:val="clear" w:color="auto" w:fill="D4EDDA"/>'
// FORK: export for unit tests 2026-05-08
export function styleInlineCode(docXml: string): string {
  return docXml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (full, inner) => {
    const hasMdCode = /<w:rStyle\s+w:val="MdCode"\/>/.test(inner)
    const hasUnderline = /<w:u\b[^/]*\/>/.test(inner)
    if (!hasMdCode || !hasUnderline) return full
    let newInner = inner.replace(/<w:u\b[^/]*\/>/g, "")
    if (!newInner.includes("<w:shd")) newInner += INLINE_CODE_SHD
    return `<w:rPr>${newInner}</w:rPr>`
  })
}

// FORK: 2026-05-08 — <u> 下划线 sentinel 应用 — 找含 sentinel 的 run,切成 [前/中(下划线)/后] 三段
// FORK: export for unit tests 2026-05-08
export function applyUnderlineSentinels(docXml: string): string {
  return docXml.replace(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g, (full, inner) => {
    const tMatch = inner.match(/(<w:t[^>]*>)([\s\S]*?)<\/w:t>/)
    if (!tMatch) return full
    const text = tMatch[2]
    if (!text.includes(UND_OPEN)) return full

    const rPrMatch = inner.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
    const rPr = rPrMatch ? rPrMatch[0] : ""
    const undRPr = rPr
      ? rPr.replace("</w:rPr>", '<w:u w:val="single"/></w:rPr>')
      : '<w:rPr><w:u w:val="single"/></w:rPr>'

    // 切分:遇 OPEN 进入下划线段,遇 CLOSE 退出
    const segments: Array<{ t: string; u: boolean }> = []
    let buf = ""
    let inU = false
    for (const ch of text) {
      if (ch === UND_OPEN) {
        if (buf) segments.push({ t: buf, u: false })
        buf = ""
        inU = true
      } else if (ch === UND_CLOSE) {
        if (buf) segments.push({ t: buf, u: true })
        buf = ""
        inU = false
      } else {
        buf += ch
      }
    }
    if (buf) segments.push({ t: buf, u: inU })

    return segments
      .filter((s) => s.t.length > 0)
      .map(
        (s) =>
          `<w:r>${s.u ? undRPr : rPr}<w:t xml:space="preserve">${escapeXml(s.t)}</w:t></w:r>`,
      )
      .join("")
  })
}

// FORK: 2026-05-08 — 颜色徽章 sentinel 应用 — 找 BADGE_OPEN...BADGE_MID...BADGE_CLOSE 三段
// FORK: export for unit tests 2026-05-08
export function applyColorBadgeSentinels(docXml: string): string {
  return docXml.replace(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g, (full, inner) => {
    const tMatch = inner.match(/(<w:t[^>]*>)([\s\S]*?)<\/w:t>/)
    if (!tMatch) return full
    const text = tMatch[2]
    if (!text.includes(BADGE_OPEN)) return full

    const rPrMatch = inner.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
    const rPr = rPrMatch ? rPrMatch[0] : ""

    // 解析:逐字符扫描,识别 OPEN..MID..CLOSE 三态
    type Seg = { t: string; bg?: string; fg?: string }
    const segments: Seg[] = []
    let buf = ""
    let mode: "plain" | "meta" | "content" = "plain"
    let curBg = ""
    let curFg = ""
    let curMeta = ""
    for (const ch of text) {
      if (ch === BADGE_OPEN) {
        if (buf) segments.push({ t: buf })
        buf = ""
        curMeta = ""
        mode = "meta"
      } else if (ch === BADGE_MID && mode === "meta") {
        const bgM = curMeta.match(/bg=([^,]*)/)
        const fgM = curMeta.match(/fg=([^,]*)/)
        curBg = bgM?.[1] ?? ""
        curFg = fgM?.[1] ?? ""
        mode = "content"
      } else if (ch === BADGE_CLOSE && mode === "content") {
        if (buf) segments.push({ t: buf, bg: curBg, fg: curFg })
        buf = ""
        mode = "plain"
      } else if (mode === "meta") {
        curMeta += ch
      } else {
        buf += ch
      }
    }
    if (buf) segments.push({ t: buf })

    return segments
      .filter((s) => s.t.length > 0)
      .map((s) => {
        if (!s.bg && !s.fg) {
          return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(s.t)}</w:t></w:r>`
        }
        const inner2 = (rPr ? rPr.replace(/<\/w:rPr>$/, "") : "<w:rPr>") +
          (s.fg ? `<w:color w:val="${s.fg}"/>` : "") +
          (s.bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${s.bg}"/>` : "") +
          "</w:rPr>"
        return `<w:r>${inner2}<w:t xml:space="preserve">${escapeXml(s.t)}</w:t></w:r>`
      })
      .join("")
  })
}

/** 简易 XML escape — sentinel 切割后的文本可能含 &<> 等需转义 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

// FORK: 2026-05-08 — 居中容器 sentinel 应用 — OPEN 段(只含 sentinel)删除,后续段加 <w:jc w:val="center"/>,直到 CLOSE 段(也删除)
// FORK: export for unit tests 2026-05-08
export function applyCenterSentinels(docXml: string): string {
  let inCenter = false
  return docXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    const hasOpen = para.includes(CENTER_OPEN)
    const hasClose = para.includes(CENTER_CLOSE)

    // marker 段(只含 sentinel,无实际文本)— 删除
    // 简单识别:整段包含 sentinel 且去掉 sentinel + tags 后基本无文本
    if (hasOpen && !hasClose) {
      const tMatch = para.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/)
      const text = tMatch ? tMatch[1] : ""
      const stripped = text.replace(new RegExp(CENTER_OPEN, "g"), "").trim()
      if (stripped.length === 0) {
        inCenter = true
        return ""
      }
      // 否则:OPEN 在文本中间,直接 strip sentinel,从这段开始居中
      inCenter = true
      const cleaned = para.replace(new RegExp(CENTER_OPEN, "g"), "")
      return addCenterAlign(cleaned)
    }
    if (hasClose) {
      const tMatch = para.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/)
      const text = tMatch ? tMatch[1] : ""
      const stripped = text.replace(new RegExp(CENTER_CLOSE, "g"), "").trim()
      if (stripped.length === 0) {
        inCenter = false
        return ""
      }
      // CLOSE 在文本中间,strip sentinel,该段仍居中,后续不再居中
      inCenter = false
      const cleaned = para.replace(new RegExp(CENTER_CLOSE, "g"), "")
      return addCenterAlign(cleaned)
    }
    if (inCenter) {
      return addCenterAlign(para)
    }
    return para
  })
}

/** 给单段加 <w:jc w:val="center"/>(已有则替换)
 *  OOXML 顺序:jc 在 spacing/ind 之后,但 Word 通常容忍。为保险插在 pPr 末尾(所有其他属性后)
 */
function addCenterAlign(para: string): string {
  if (/<w:jc\b[^>]*w:val="center"/.test(para)) return para
  if (/<w:jc\b[^/]*\/>/.test(para)) {
    return para.replace(/<w:jc\b[^/]*\/>/, '<w:jc w:val="center"/>')
  }
  if (/<w:pPr>[\s\S]*?<\/w:pPr>/.test(para)) {
    return para.replace("</w:pPr>", '<w:jc w:val="center"/></w:pPr>')
  }
  return para.replace(/<w:p\b[^>]*>/, (m) => `${m}<w:pPr><w:jc w:val="center"/></w:pPr>`)
}

// FORK: 2026-05-08 — 表格全边框 + 表格后空段做间距
// 库默认只渲染部分边框(看 user 截图 #92 vs #93),user 期望全边框完整网格 + 表格与下文有间距
const TBL_BORDER_COLOR = "D0D7DE"
const TBL_FULL_BORDERS =
  `<w:tblBorders>` +
  `<w:top w:val="single" w:sz="4" w:space="0" w:color="${TBL_BORDER_COLOR}"/>` +
  `<w:left w:val="single" w:sz="4" w:space="0" w:color="${TBL_BORDER_COLOR}"/>` +
  `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="${TBL_BORDER_COLOR}"/>` +
  `<w:right w:val="single" w:sz="4" w:space="0" w:color="${TBL_BORDER_COLOR}"/>` +
  `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="${TBL_BORDER_COLOR}"/>` +
  `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="${TBL_BORDER_COLOR}"/>` +
  `</w:tblBorders>`

/** 给所有表格加完整 6 边框(替换或新增 tblBorders) */
// FORK: export for unit tests 2026-05-08
export function applyTableBorders(docXml: string): string {
  return docXml.replace(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g, (full) => {
    let modified = full
    if (/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.test(modified)) {
      modified = modified.replace(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/, TBL_FULL_BORDERS)
    } else if (/<w:tblPr>/.test(modified)) {
      modified = modified.replace("<w:tblPr>", `<w:tblPr>${TBL_FULL_BORDERS}`)
    } else {
      modified = modified.replace(
        /<w:tbl\b[^>]*>/,
        (m) => `${m}<w:tblPr>${TBL_FULL_BORDERS}</w:tblPr>`,
      )
    }
    return modified
  })
}

// FORK: 2026-05-08 — heading slug,与 packages/ui marked.tsx 的 slugifyHeading 对齐
//   `# 1. 标题层级` → "1-标题层级",中文保留 + 标点剥 + 空格转连字符
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}一-龥\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// OOXML bookmark name 限制:必须 letter 开头、最长 40 字符、避免 hyphen
// slug 直接用可能违规("1-标题..." 数字开头 + 含 - 中文);加 "h_" 前缀 + 截 40 字符
function slugToBookmarkName(slug: string): string {
  return ("h_" + slug).slice(0, 40)
}

/** 给所有 heading 段加 <w:bookmarkStart>/<w:bookmarkEnd>(name = slug)
 *  把 #anchor 形式的 external hyperlink 转成 internal w:anchor 跳转
 *  返回 { docXml, relsXml }
 */
// FORK: export for unit tests 2026-05-08
export function applyHeadingBookmarksAndAnchors(docXml: string, relsXml: string): {
  docXml: string
  relsXml: string
} {
  // 1. 解析 _rels:找 hyperlink target=#anchor 的 Relationship,记 rId → anchor
  // 注:Type 属性含 URL(http://...)有 `/`,不能用 [^/] 字符类排除;改用 attribute-based 提取
  const anchorRels = new Map<string, string>()
  const newRelsXml = relsXml.replace(/<Relationship\b[^>]*?\/>/g, (full) => {
    const idMatch = full.match(/\bId="([^"]+)"/)
    const targetMatch = full.match(/\bTarget="#([^"]+)"/) // 仅 # 开头(internal anchor)
    const typeMatch = full.match(/\bType="([^"]+)"/)
    if (!idMatch || !targetMatch || !typeMatch) return full
    if (!typeMatch[1].includes("hyperlink")) return full
    let slug = targetMatch[1]
    try {
      slug = decodeURIComponent(slug)
    } catch {
      // ignore decode error
    }
    // anchor target 用同款 bookmark name 规则(h_ 前缀 + 40 字符截断)
    anchorRels.set(idMatch[1], slugToBookmarkName(slug))
    return "" // 删除 internal anchor 的 external rel
  })

  let newDocXml = docXml

  // 2. 把 <w:hyperlink ... r:id="rId" ...> 替换为 <w:hyperlink ... w:anchor="anchor" ...>
  // 注:r:id 可能不是第一个 attr(库会出 <w:hyperlink w:history="1" r:id="...">),
  // 也可能 ID 含字母 + 下划线非纯数字(库用 hash);用 attribute 提取避免位置假设
  if (anchorRels.size > 0) {
    newDocXml = newDocXml.replace(/<w:hyperlink\b[^>]*>/g, (full) => {
      const rIdMatch = full.match(/\sr:id="([^"]+)"/)
      if (!rIdMatch) return full
      const anchor = anchorRels.get(rIdMatch[1])
      if (!anchor) return full
      // 删 r:id 属性,在 > 前插 w:anchor
      const stripped = full.replace(/\sr:id="[^"]+"/, "")
      return stripped.replace(/>$/, ` w:anchor="${anchor}">`)
    })
  }

  // 3. 给每个 heading 段加 bookmark(name = slug)
  // 关键:Word 要求 bookmark id 全局唯一 + bookmark name 全局唯一。
  // 同 slug 多次出现(如目录 link 同名 + 章节 heading 同名)→ 第一个 name=slug,后续加 -N 后缀
  // bookmark id 永远递增,绝不复用
  let bmkId = 1000
  const slugCount = new Map<string, number>()
  newDocXml = newDocXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paraXml) => {
    const headingMatch = paraXml.match(
      /<w:pStyle\s+w:val="(?:Md)?Heading[1-6]"\s*\/>/,
    )
    if (!headingMatch) return paraXml
    const text = [...paraXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((m) => m[1])
      .join("")
    const baseSlug = slugifyHeading(text)
    if (!baseSlug) return paraXml
    const count = slugCount.get(baseSlug) ?? 0
    slugCount.set(baseSlug, count + 1)
    // 第一次出现保 baseSlug(目录 anchor 指向它);后续加后缀避免重名
    // 应用 OOXML bookmark name 规则(h_ 前缀 + 40 字符截断)
    const slugForName = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`
    const name = slugToBookmarkName(slugForName)
    const id = bmkId++
    let modified: string
    if (/<\/w:pPr>/.test(paraXml)) {
      modified = paraXml.replace(
        /<\/w:pPr>/,
        `</w:pPr><w:bookmarkStart w:id="${id}" w:name="${name}"/>`,
      )
    } else {
      modified = paraXml.replace(
        /<w:p\b[^>]*>/,
        (m) => `${m}<w:bookmarkStart w:id="${id}" w:name="${name}"/>`,
      )
    }
    modified = modified.replace(/<\/w:p>$/, `<w:bookmarkEnd w:id="${id}"/></w:p>`)
    return modified
  })

  return { docXml: newDocXml, relsXml: newRelsXml }
}

/** 给含 MdTableHeader 段的 cell 加浅灰底色(表格 title 行) */
// FORK: export for unit tests 2026-05-08
export function applyTableHeaderShading(docXml: string): string {
  const headerShd = '<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>'
  return docXml.replace(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g, (full, inner) => {
    if (!/<w:pStyle\s+w:val="MdTableHeader"/.test(inner)) return full
    // 已有 shd 替换为 header 灰;无则在 tcPr 内插
    if (/<w:tcPr>/.test(full)) {
      if (/<w:tcPr>[\s\S]*?<w:shd\b[^/]*\/>/.test(full)) {
        return full.replace(/(<w:tcPr>[\s\S]*?)<w:shd\b[^/]*\/>/, `$1${headerShd}`)
      }
      return full.replace("<w:tcPr>", `<w:tcPr>${headerShd}`)
    }
    // 无 tcPr — 在 <w:tc> 开始之后插
    return full.replace(/<w:tc\b[^>]*>/, (m) => `${m}<w:tcPr>${headerShd}</w:tcPr>`)
  })
}

/** 表格前后插入空段做间距 — 防止上/下段(尤其 blockquote)紧贴表格 */
// FORK: export for unit tests 2026-05-08
export function applyTableSpacing(docXml: string): string {
  // 在 applyBlockquoteGroups 之后跑,所以加的 spacer 不会被 group 吸收套 BQ 样式
  // 表格按其自己样式展现,与上下段隔开一行视觉空间
  const spacerBefore = `<w:p><w:pPr><w:spacing w:before="240" w:after="0"/></w:pPr></w:p>`
  const spacerAfter = `<w:p><w:pPr><w:spacing w:before="240" w:after="0"/></w:pPr></w:p>`
  let out = docXml
  out = out.replace(/<w:tbl\b/g, `${spacerBefore}<w:tbl`)
  out = out.replace(/<\/w:tbl>/g, `</w:tbl>${spacerAfter}`)
  return out
}

// FORK: 2026-05-08 v3 — 基于 sentinel 边界识别 blockquote group
// preprocessMarkdown 里 wrapBlockquoteBlocks 给每个独立块前后加 sentinel(单独段)
// 这里:① 找 OPEN sentinel 段 → group 起;② 找 CLOSE sentinel 段 → group 止
//      ③ group 内 MdSpace 段全删;④ MdBlockquote 段加 inline spacing 0/0(首段保 before,末段保 after)
//      ⑤ group 内段加自定义 pBdr(左竖线对应颜色)+ <w:shd>(浅底色)
//      ⑥ sentinel 段本身删除
// FORK: export for unit tests 2026-05-08
export function applyBlockquoteGroups(docXml: string): string {
  // 改用 top-level 元素扫描(<w:p> 或 <w:tbl>),table 作为整体保留
  // 之前只匹配 <w:p> 会把 <w:tbl> 内 cell 的 <w:p> 也算进 group,导致 replaceStart..replaceEnd 把 <w:tbl> 干掉
  const elementPattern = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g
  const elements = [...docXml.matchAll(elementPattern)]
  if (elements.length === 0) return docXml

  type Info = {
    idx: number
    full: string
    isTbl: boolean
    isSpace: boolean
    /** sentinel 字符:OPEN_PLAIN/OPEN_NOTE/.../CLOSE,空表示非 sentinel */
    sentinel: string
  }
  const SENTINELS = [
    QUOTE_OPEN_PLAIN, QUOTE_OPEN_NOTE, QUOTE_OPEN_TIP, QUOTE_OPEN_WARNING,
    QUOTE_OPEN_CAUTION, QUOTE_OPEN_IMPORTANT, QUOTE_CLOSE,
  ]
  const infos: Info[] = elements.map((m) => {
    const el = m[0]
    const isTbl = el.startsWith("<w:tbl")
    if (isTbl) {
      return { idx: m.index!, full: el, isTbl: true, isSpace: false, sentinel: "" }
    }
    const pPr = el.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? ""
    const allText = [...el.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join("")
    return {
      idx: m.index!,
      full: el,
      isTbl: false,
      isSpace: /<w:pStyle\s+w:val="MdSpace"/.test(pPr),
      sentinel: SENTINELS.find((s) => allText.includes(s)) ?? "",
    }
  })

  // 找 group:从 OPEN sentinel 段起,到 CLOSE sentinel 段止
  type Group = { startIdx: number; endIdx: number; openType: string }
  const groups: Group[] = []
  let curOpen: { i: number; type: string } | null = null
  for (let k = 0; k < infos.length; k++) {
    const s = infos[k].sentinel
    if (!s) continue
    if (s === QUOTE_CLOSE && curOpen) {
      groups.push({ startIdx: curOpen.i, endIdx: k, openType: curOpen.type })
      curOpen = null
    } else if (s !== QUOTE_CLOSE) {
      curOpen = { i: k, type: s }
    }
  }
  if (groups.length === 0) return docXml

  // 倒序替换以避免 index 漂移
  let result = docXml
  for (let g = groups.length - 1; g >= 0; g--) {
    const grp = groups[g]
    const startInfo = infos[grp.startIdx]
    const endInfo = infos[grp.endIdx]
    const replaceStart = startInfo.idx
    const replaceEnd = endInfo.idx + endInfo.full.length
    const style = QUOTE_STYLE[grp.openType] ?? QUOTE_STYLE[QUOTE_OPEN_PLAIN]

    // group 内元素(OPEN/CLOSE 之间)
    const innerInfos = infos.slice(grp.startIdx + 1, grp.endIdx)
    // 过滤:删 MdSpace 段(<w:tbl> 元素保留)
    const kept = innerInfos.filter((e) => !e.isSpace)

    const newElems = kept.map((info, k) => {
      const isFirst = k === 0
      const isLast = k === kept.length - 1
      if (info.isTbl) {
        // OOXML 限制:<w:tbl> 是 body 顶层元素,与 <w:p> 同级,无法真正嵌入 BQ 容器
        // 强行套 tblBorders.left + cell shading 视觉违和(表格独立成块,与段视觉脱节)
        // 决定:group 内表格原样保留,接受其独立显示
        return info.full
      }
      const before = isFirst ? "200" : "0"
      const after = isLast ? "200" : "0"
      return applyQuoteStyles(info.full, {
        before,
        after,
        borderColor: style.border,
        fillColor: style.fill,
      })
    })

    result = result.slice(0, replaceStart) + newElems.join("") + result.slice(replaceEnd)
  }
  return result
}

/** 给单段加 inline spacing + 自定义 pBdr 左竖线 + 段落浅底色 shading
 *  关键:OOXML CT_PPrBase 子元素顺序固定 — pStyle → pBdr → shd → spacing → ind → jc → ...
 *  之前用 prepend 插 pPr 头,顺序反了 Word 部分属性失效(如 shd 不渲染)
 */
function applyQuoteStyles(
  para: string,
  opts: { before: string; after: string; borderColor: string; fillColor: string },
): string {
  const newSpacing = `<w:spacing w:before="${opts.before}" w:after="${opts.after}"/>`
  const newPBdr =
    `<w:pBdr><w:left w:val="single" w:sz="20" w:color="${opts.borderColor}" w:space="12"/></w:pBdr>`
  const newShd = `<w:shd w:val="clear" w:color="auto" w:fill="${opts.fillColor}"/>`

  let out = para
  // 1. 删除现有的 spacing / pBdr / shd(我们要按 OOXML 顺序重新放)
  out = out.replace(/<w:spacing\b[^/]*\/>/g, "")
  out = out.replace(/<w:pBdr>[\s\S]*?<\/w:pBdr>/g, "")
  out = out.replace(/<w:shd\b[^/]*\/>/g, "")

  // 2. 按 OOXML 顺序组合:pBdr → shd → spacing
  const block = `${newPBdr}${newShd}${newSpacing}`

  // 3. 插入位置:在 pStyle 后(优先),其次 pPr 头,最后无 pPr 时新建
  if (/<w:pStyle\b[^/]*\/>/.test(out)) {
    out = out.replace(/<w:pStyle\b[^/]*\/>/, (m) => `${m}${block}`)
  } else if (/<w:pPr>/.test(out)) {
    out = out.replace(/<w:pPr>/, `<w:pPr>${block}`)
  } else {
    out = out.replace(/<w:p\b[^>]*>/, (m) => `${m}<w:pPr>${block}</w:pPr>`)
  }
  return out
}

// FORK: 2026-05-08 v2 — 走库的 imageAdapter 选项,完全绕开库的 fetch(WebView2 CSP 拦了 fetch(data:URL))
// 之前 v1 把 https → data: URL 还交回给库 fetch,Tauri WebView2 仍拦,改成 imageAdapter 直接喂 bytes

/** PNG 头解析 — 字节 16-23 是 width/height 大端 32 位 */
// FORK: export for unit tests 2026-05-08
export function parsePngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
  ) return null
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
  return { width, height }
}

/** JPEG 头解析 — 扫 SOF marker(FF C0/C1/C2/C3),后面 5 字节是 precision+height+width(big-endian 16) */
// FORK: export for unit tests 2026-05-08
export function parseJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4) return null
  // SOI: FF D8
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i++
      continue
    }
    const marker = bytes[i + 1]
    // SOF0/1/2/3/5/6/7/9/A/B/D/E/F:都含 dim
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      // segment: FF Cx + len(2) + precision(1) + height(2) + width(2) + ...
      const height = (bytes[i + 5] << 8) | bytes[i + 6]
      const width = (bytes[i + 7] << 8) | bytes[i + 8]
      return { width, height }
    }
    // skip segment(下一段:位置+2 是 segment 长度,大端 16 位)
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      i += 2
      continue
    }
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    i += 2 + segLen
  }
  return null
}

/** GIF 头解析 — 字节 6-9 是 width/height 小端 16 位 */
// FORK: export for unit tests 2026-05-08
export function parseGifSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null
  // GIF89a / GIF87a
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null
  const width = bytes[6] | (bytes[7] << 8)
  const height = bytes[8] | (bytes[9] << 8)
  return { width, height }
}

/** 综合 dimension — 按 mime 路由,失败 fallback 默认 600x400(库默认) */
function decodeImageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } {
  let dims: { width: number; height: number } | null = null
  if (mime.includes("png")) dims = parsePngSize(bytes)
  else if (mime.includes("jpeg") || mime.includes("jpg")) dims = parseJpegSize(bytes)
  else if (mime.includes("gif")) dims = parseGifSize(bytes)
  // BMP / WebP / SVG 暂不支持,fallback
  if (!dims || dims.width <= 0 || dims.height <= 0) return { width: 600, height: 400 }
  return dims
}

/** 字节头 sniff mime — 不靠 URL 后缀,placehold.co 这类服务返 SVG 但 URL 无后缀 */
// FORK: export for unit tests 2026-05-08
export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length < 4) return "application/octet-stream"
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif"
  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp"
  // WebP: RIFF ... WEBP
  if (
    bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp"
  // SVG / XML — text content,看头部是不是 < ... svg
  try {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 256)).trimStart().toLowerCase()
    if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml"
  } catch {
    /* ignore */
  }
  return "application/octet-stream"
}

/** SVG / WebP / 其他非 PNG/JPEG/GIF/BMP 字节经 canvas 转 PNG bytes
 * 库的 MarkdownImageType 只接受 jpg/png/gif/bmp,不支持 SVG/WebP — 必须前端转格式
 * Mermaid 路径已有同款逻辑(svgToPngDataUrl),这里复用思路:Image.src = blobURL → canvas → toBlob(png)
 */
async function convertImageBytesToPng(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  // Uint8Array → BlobPart(TS 5.x 严格,用 any cast 绕)
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("image decode failed"))
      img.src = url
    })
    const width = img.naturalWidth || 600
    const height = img.naturalHeight || 400
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    // 白底防 SVG/WebP 透明导致 PDF 看不见
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    )
    if (!pngBlob) return null
    const buf = await pngBlob.arrayBuffer()
    return { bytes: new Uint8Array(buf), width, height }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 库 imageAdapter — Tauri 拉 bytes + sniff mime + 自解析尺寸,绕开库的 fetch
 * SVG / WebP / 其他不被库直接支持的格式 → 经 canvas 转 PNG bytes
 * 库支持的 PNG/JPEG/GIF/BMP → 直接喂字节
 */
// FORK: export for unit tests 2026-05-08
export function buildImageAdapter(opts: {
  fetchUrl: (url: string) => Promise<string>
  onFail?: (url: string, err: unknown) => void
  /** 注入 svg/webp → png 转换器(prod 用 canvas;test 可 mock) */
  convertNonNative?: (
    bytes: Uint8Array,
    mime: string,
  ) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>
}) {
  const convertNonNative = opts.convertNonNative ?? convertImageBytesToPng
  return async (token: { href?: string; text?: string }): Promise<{
    type: "jpg" | "png" | "gif" | "bmp"
    data: Uint8Array
    width: number
    height: number
  } | null> => {
    const href = token.href
    if (!href) return null

    let bytes: Uint8Array | null = null

    try {
      if (/^data:/i.test(href)) {
        const m = href.match(/^data:([^;,]+)(?:;base64)?,(.*)$/)
        if (!m) return null
        bytes = base64ToBytes(m[2])
      } else if (/^https?:/i.test(href)) {
        const b64 = await opts.fetchUrl(href)
        bytes = base64ToBytes(b64)
      } else {
        return null
      }
    } catch (err) {
      opts.onFail?.(href, err)
      return null
    }

    if (!bytes) return null

    // sniff 字节头,不靠 URL 后缀(placehold.co 等服务可能返 SVG)
    const mime = sniffImageMime(bytes)

    // 库直接支持的格式 — PNG/JPEG/GIF/BMP
    if (mime === "image/png" || mime === "image/jpeg" || mime === "image/gif" || mime === "image/bmp") {
      const { width, height } = decodeImageDimensions(bytes, mime)
      let type: "jpg" | "png" | "gif" | "bmp" = "png"
      if (mime === "image/jpeg") type = "jpg"
      else if (mime === "image/gif") type = "gif"
      else if (mime === "image/bmp") type = "bmp"
      return { type, data: bytes, width, height }
    }

    // SVG / WebP / 未知格式 — 经 canvas 转 PNG
    const converted = await convertNonNative(bytes, mime || "application/octet-stream")
    if (!converted) {
      opts.onFail?.(href, new Error(`unsupported image format: ${mime}`))
      return null
    }
    return {
      type: "png",
      data: converted.bytes,
      width: converted.width,
      height: converted.height,
    }
  }
}

// FORK: Mermaid SVG → PNG (A2) — 库不渲染 mermaid,会出 ```mermaid 源码块
// 改:从 viewer DOM 拿已渲染的 SVG → canvas 转 PNG dataURL → 替换 markdown 块为 ![](dataurl)
// viewer 选择器:.markdown-mermaid-rendered(packages/ui/src/components/markdown.tsx:292)
// 2026-05-06

/** clone SVG 后把 foreignObject 替换成 SVG text — viewer 显示用 HTML labels(美观),
 *  导出用 SVG text(WKWebView 转 image 时 foreignObject 会触发 tainted canvas / "operation is insecure")。
 *  保留 viewer 显示效果不变,只对导出 clone 做替换。
 */
// FORK: export for unit tests 2026-05-07
export function patchForeignObjects(svgEl: SVGElement): void {
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

// FORK: export for unit tests(R5 测试纪律 / 关键模块清单)2026-05-07
export function mimeFromPath(p: string): string | null {
  const lower = p.toLowerCase()
  for (const [ext, mime] of Object.entries(IMG_MIME)) {
    if (lower.endsWith(ext)) return mime
  }
  return null
}

/** 把 markdown 里 ![](path) 的本地相对/绝对图替换为 base64 dataURL。
 * 跳过 http(s) / data / blob / 锚点等;读失败保留原 path(library 端会 broken,但不阻塞导出)
 */
// FORK: export for unit tests(R5 决策 2 / D4 — Tauri invoke mock)2026-05-07
export async function inlineLocalImages(md: string, mdFileDir?: string): Promise<string> {
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

// FORK: D — 库不支持的 markdown 语法预处理 2026-05-08
// 库基于 marked@15(无扩展),许多 GFM/HTML 语法被库当 raw text 渲染。
// 这里把不支持的语法降级转换为库能正确渲染的近似形式,文本可读优先,装饰性视觉降级。
//
// 修复范围(8 种):
//  ① <u> / <kbd> / ==X==   → 去标签,失下划线/键盘样式/高亮(纯文本可读)
//  ② <sup> / <sub>         → Unicode 上下标(数字/常见符号);含不支持字符则去标签
//  ③ GFM Alerts            → > [!NOTE] → > **📌 提示**\n>\n> 内容
//  ④ HTML <img>            → ![alt](src)(库走图片管道,仍依赖 fetch 可达)
//  ⑤ <details><summary>X   → **▶ X**\n\n 内容
//  ⑥ <span style="...">    → 去标签
//  ⑦ <div> / <p>           → unwrap(失对齐)
//  ⑧ 定义列表 Term\n:  Def → **Term**: Def
//
// 不修复(明确局限):
//  - LaTeX 数学公式 $...$ / $$...$$ — 库 + marked@15 不支持,需 KaTeX→PNG 单独迭代
//  - 复杂 HTML 嵌套(table/iframe 等)
//  - <div align="center"> 居中 — unwrap 后丢对齐(需 Word 段落属性,复杂)

const SUP_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  " ": " ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ",
  f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ",
  l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ",
  s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ",
  y: "ʸ", z: "ᶻ",
}

const SUB_MAP: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  " ": " ", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ",
  k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ",
  r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
}

// FORK: 2026-05-08 — GFM emoji shortcode 表,与 packages/ui/src/context/marked.tsx 同步
// preprocess 时把 :rocket: 等转 Unicode 字符,后处理走 splitRunsForEmoji 给 emoji 字体
const EMOJI_SHORTCODES: Record<string, string> = {
  rocket: "🚀", tada: "🎉", sparkles: "✨", white_check_mark: "✅",
  warning: "⚠️", bug: "🐛", book: "📖", art: "🎨",
  smile: "😄", grin: "😁", joy: "😂", laughing: "😆", wink: "😉",
  blush: "😊", heart_eyes: "😍", thinking: "🤔", cry: "😢", angry: "😠",
  thumbsup: "👍", "+1": "👍", thumbsdown: "👎", "-1": "👎",
  ok_hand: "👌", clap: "👏", pray: "🙏", muscle: "💪", wave: "👋",
  heart: "❤️", broken_heart: "💔", star: "⭐", star2: "🌟",
  fire: "🔥", boom: "💥", zap: "⚡", bulb: "💡",
  x: "❌", o: "⭕", heavy_check_mark: "✔️", heavy_multiplication_x: "✖️",
  question: "❓", exclamation: "❗", grey_question: "❔", grey_exclamation: "❕",
  no_entry: "⛔", no_entry_sign: "🚫", recycle: "♻️",
  computer: "💻", phone: "📱", iphone: "📱", email: "📧", mailbox: "📫",
  package: "📦", file_folder: "📁", open_file_folder: "📂", page_facing_up: "📄",
  pencil: "📝", memo: "📝", paperclip: "📎", chart_with_upwards_trend: "📈",
  chart_with_downwards_trend: "📉", bar_chart: "📊", date: "📅",
  sun: "☀️", cloud: "☁️", umbrella: "☂️", snowflake: "❄️",
  rainbow: "🌈", ocean: "🌊", mountain: "⛰️",
  dog: "🐶", cat: "🐱", mouse: "🐭", panda_face: "🐼", lion: "🦁",
  coffee: "☕", tea: "🍵", beer: "🍺", pizza: "🍕", hamburger: "🍔",
  apple: "🍎", lemon: "🍋", strawberry: "🍓", watermelon: "🍉",
  car: "🚗", taxi: "🚕", bus: "🚌", airplane: "✈️", ship: "🚢",
  rocket_alt: "🚀",
  clock: "🕐", hourglass: "⌛", alarm_clock: "⏰",
  gift: "🎁", trophy: "🏆", medal: "🏅", crown: "👑",
  earth_americas: "🌎", earth_asia: "🌏", earth_africa: "🌍",
}

/** 把字符串转 Unicode 上标;含不支持字符返 null */
// FORK: export for unit tests 2026-05-08
export function toUnicodeSup(s: string): string | null {
  let out = ""
  for (const ch of s) {
    const m = SUP_MAP[ch]
    if (!m) return null
    out += m
  }
  return out
}

/** 把字符串转 Unicode 下标;含不支持字符返 null */
// FORK: export for unit tests 2026-05-08
export function toUnicodeSub(s: string): string | null {
  let out = ""
  for (const ch of s) {
    const m = SUB_MAP[ch]
    if (!m) return null
    out += m
  }
  return out
}

// FORK: 2026-05-08 — 不做中英翻译,保留原 GFM Alerts 英文标签 + emoji 装饰
const ALERT_LABELS: Record<string, string> = {
  NOTE: "📌 Note",
  TIP: "💡 Tip",
  WARNING: "⚠️ Warning",
  CAUTION: "🚨 Caution",
  IMPORTANT: "❗ Important",
}

// FORK: 2026-05-08 sentinel — Unicode PUA 字符,marked 当文本透传,docx 后处理时按 sentinel 切 run 加属性
// 用于 <u> 下划线 + 颜色徽章(span style)— 库本身无 markdown 语法支持下划线/底色,只能这条路
export const UND_OPEN = String.fromCharCode(0xe100)
export const UND_CLOSE = String.fromCharCode(0xe101)
export const BADGE_OPEN = String.fromCharCode(0xe110) // 后跟 metadata "bg=4CAF50,fg=FFFFFF"
export const BADGE_MID = String.fromCharCode(0xe111) // metadata / content 分隔
export const BADGE_CLOSE = String.fromCharCode(0xe112)
// 居中容器(<div align="center">/<p align="center">)— 单独段落 marker
// post-process 时遇 OPEN 段开始,后续段全加 <w:jc w:val="center"/>,直到 CLOSE 段
export const CENTER_OPEN = String.fromCharCode(0xe120)
export const CENTER_CLOSE = String.fromCharCode(0xe121)
// Blockquote group sentinel — 给每个独立 blockquote 块标边界
// 库会把所有连续 > 行拍成 BQ + MdSpace 序列,丢失独立块边界,合并 vs 分隔不可区分
// 解:预处理给每个块前后加 sentinel(单独段),后处理按 sentinel 识 group + 删 sentinel
export const QUOTE_OPEN_PLAIN = String.fromCharCode(0xe130)
export const QUOTE_OPEN_NOTE = String.fromCharCode(0xe131)
export const QUOTE_OPEN_TIP = String.fromCharCode(0xe132)
export const QUOTE_OPEN_WARNING = String.fromCharCode(0xe133)
export const QUOTE_OPEN_CAUTION = String.fromCharCode(0xe134)
export const QUOTE_OPEN_IMPORTANT = String.fromCharCode(0xe135)
export const QUOTE_CLOSE = String.fromCharCode(0xe13f)

const ALERT_OPEN_BY_TYPE: Record<string, string> = {
  NOTE: QUOTE_OPEN_NOTE,
  TIP: QUOTE_OPEN_TIP,
  WARNING: QUOTE_OPEN_WARNING,
  CAUTION: QUOTE_OPEN_CAUTION,
  IMPORTANT: QUOTE_OPEN_IMPORTANT,
}

/** group 视觉样式:左竖线颜色 + 浅底色 — 对齐 GitHub viewer 的 GFM Alerts 配色 */
const QUOTE_STYLE: Record<string, { border: string; fill: string }> = {
  [QUOTE_OPEN_PLAIN]: { border: "D0D7DE", fill: "F6F8FA" },
  [QUOTE_OPEN_NOTE]: { border: "0969DA", fill: "DDF4FF" },
  [QUOTE_OPEN_TIP]: { border: "1A7F37", fill: "DAFBE1" },
  [QUOTE_OPEN_WARNING]: { border: "9A6700", fill: "FFF8C5" },
  [QUOTE_OPEN_CAUTION]: { border: "CF222E", fill: "FFEBE9" },
  [QUOTE_OPEN_IMPORTANT]: { border: "8250DF", fill: "FBEFFF" },
}

/** #fff → FFFFFF;#4CAF50 → 4CAF50;不识别返 null */
// FORK: export for unit tests 2026-05-08
export function normalizeHex(s: string): string | null {
  if (!s) return null
  const cleaned = s.trim().replace(/^#/, "")
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return cleaned
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return cleaned.toUpperCase()
  return null
}

/** 扫 markdown 行,把每个独立 blockquote 块(连续 > 行)前后加 sentinel 段
 *  GFM Alert 块(第一行 `> [!TYPE]`)用 type-specific OPEN sentinel + 重写第一行为 `> **🔖 Type**` label
 *  Sentinel 单独成段(空行隔开)— marked 把它当 paragraph,docx 输出后 sentinel 段易识别
 */
// FORK: export for unit tests 2026-05-08
export function wrapBlockquoteBlocks(md: string): string {
  const lines = md.split("\n")
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    if (/^[ \t]*>/.test(lines[i])) {
      // 找连续 > 块
      let j = i
      while (j < lines.length && /^[ \t]*>/.test(lines[j])) j++
      const block = lines.slice(i, j)

      // 检测是否是 GFM Alert(第一行只是 `> [!TYPE]`)
      const alertMatch = block[0].match(/^[ \t]*>[ \t]*\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\][ \t]*$/i)
      let openSentinel = QUOTE_OPEN_PLAIN
      let outBlock = block
      if (alertMatch) {
        const type = alertMatch[1].toUpperCase()
        openSentinel = ALERT_OPEN_BY_TYPE[type] ?? QUOTE_OPEN_PLAIN
        const label = ALERT_LABELS[type] ?? type
        // 把 `> [!TYPE]` 行换成 `> **📌 Note**`,加空 `>` 行做段间气垫,然后保留 body
        outBlock = [`> **${label}**`, ">", ...block.slice(1)]
      }

      // sentinel 段单独成行(前后空行让 marked 把它当独立 paragraph)
      result.push("", openSentinel, "", ...outBlock, "", QUOTE_CLOSE, "")
      i = j
    } else {
      result.push(lines[i])
      i++
    }
  }
  return result.join("\n")
}

// FORK: export for unit tests 2026-05-08
export function preprocessMarkdown(md: string): string {
  let out = md

  // 先把代码块/行内代码占位,避免 strip 影响代码内容(如 `<sub>` 在代码示例里要保留)
  const fenced: string[] = []
  out = out.replace(/```[\s\S]*?```/g, (m) => {
    fenced.push(m)
    return ` FENCEDXY${fenced.length - 1}XYEND `
  })
  const inlineCode: string[] = []
  out = out.replace(/`[^`\n]+`/g, (m) => {
    inlineCode.push(m)
    return ` ICODEXY${inlineCode.length - 1}XYEND `
  })

  // ① 文本样式 — <u>X</u> 用 sentinel 包裹(后处理加 <w:u/>);<kbd>X</kbd> strip(键盘样式硬装饰复杂,先弃)
  out = out.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, (_, inner) => `${UND_OPEN}${inner}${UND_CLOSE}`)
  out = out.replace(/<kbd\b[^>]*>([\s\S]*?)<\/kbd>/gi, "$1")

  // ② <sup>/<sub> → Unicode(简单字符);含不支持字符则 strip
  out = out.replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_, inner) => {
    return toUnicodeSup(inner) ?? inner
  })
  out = out.replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, (_, inner) => {
    return toUnicodeSub(inner) ?? inner
  })

  // ③ ==高亮== → BADGE sentinel 黄底色块(与 viewer 的 <mark> 默认黄底渲染对齐)
  // FFF59D = Material Yellow 200,柔和明显 + 与 browser default <mark> 视觉接近
  out = out.replace(/==([^=\n]+)==/g, (_, content) => {
    return `${BADGE_OPEN}bg=FFF59D,fg=${BADGE_MID}${content}${BADGE_CLOSE}`
  })

  // ③′ GFM emoji shortcode :rocket: → 🚀(与 viewer marked extension 对齐)
  // 表外 :xxx: 保持原文(避免吞 CSS pseudo / 时间戳 12:30 等);emoji 字符走 splitRunsForEmoji 给字体
  out = out.replace(/:([a-z_+0-9-]+):/g, (full, name) => {
    return EMOJI_SHORTCODES[name] ?? full
  })

  // ④ Blockquote 块边界标记 — 每个独立 blockquote(连续 > 行)前后加 sentinel
  //    GFM Alerts(`> [!NOTE]`)用 type-specific OPEN sentinel,普通用 PLAIN
  //    后处理(applyBlockquoteGroups)按 sentinel 识 group + 删 sentinel + 加颜色 pBdr/shading
  out = wrapBlockquoteBlocks(out)

  // ⑤ HTML <img src="..." alt="..." /> → ![alt](src)
  //    width/height/title 等其他属性丢弃,只保留 src + alt
  out = out.replace(/<img\b([^>]*?)\/?>/gi, (_, attrs) => {
    const srcMatch =
      attrs.match(/\bsrc\s*=\s*"([^"]*)"/i) ?? attrs.match(/\bsrc\s*=\s*'([^']*)'/i)
    const altMatch =
      attrs.match(/\balt\s*=\s*"([^"]*)"/i) ?? attrs.match(/\balt\s*=\s*'([^']*)'/i)
    const src = srcMatch?.[1] ?? ""
    const alt = altMatch?.[1] ?? ""
    return src ? `![${alt}](${src})` : ""
  })

  // ⑥ <details><summary>X</summary>Y</details> → **▶ X**\n\nY
  out = out.replace(
    /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
    (_, summary, content) => {
      const s = String(summary).replace(/\s+/g, " ").trim()
      return `**▶ ${s}**\n\n${String(content).trim()}\n`
    },
  )

  // ⑦ <span style="background:X;color:Y">Z</span> → 颜色徽章 sentinel(后处理加 <w:shd> + <w:color>)
  //    无 style 或 style 无 background 的 span 直接 strip
  out = out.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi, (_, attrs, content) => {
    const styleMatch = String(attrs).match(/\bstyle\s*=\s*"([^"]*)"/i) ?? String(attrs).match(/\bstyle\s*=\s*'([^']*)'/i)
    if (!styleMatch) return content
    const style = styleMatch[1]
    const bgMatch = style.match(/background(?:-color)?\s*:\s*([^;]+?)(?:;|$)/i)
    const fgMatch = style.match(/(?:^|[;\s])color\s*:\s*([^;]+?)(?:;|$)/i)
    const bg = bgMatch ? normalizeHex(bgMatch[1]) : null
    const fg = fgMatch ? normalizeHex(fgMatch[1]) : null
    if (!bg && !fg) return content
    const meta = `bg=${bg ?? ""},fg=${fg ?? ""}`
    // BADGE_CLOSE 后追加空格 — 多个相邻徽章之间需要视觉间距(marked 把多个 span 行 collapse 成一段)
    return `${BADGE_OPEN}${meta}${BADGE_MID}${content}${BADGE_CLOSE} `
  })

  // ⑧ <div align="center">X</div> / <p align="center">X</p> → 居中 sentinel 包裹
  //    post-process 给段落加 <w:jc w:val="center"/>
  out = out.replace(
    /<(div|p)\b[^>]*\balign\s*=\s*["']?center["']?[^>]*>([\s\S]*?)<\/\1>/gi,
    (_, _tag, content) => {
      return `\n\n${CENTER_OPEN}\n\n${String(content).trim()}\n\n${CENTER_CLOSE}\n\n`
    },
  )

  // ⑨ 剩余 <div>/<p> 不带 center align → unwrap
  out = out.replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, "$1")
  out = out.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => {
    return `\n${String(inner).trim()}\n`
  })

  // ⑩ 定义列表 — Term\n:   Definition → **Term**: Definition
  //    严格匹配:term 单行非空非特殊起始 + 下一行以 `: `(冒号 + 空白)开头
  out = out.replace(
    /(^|\n)([^\n>:|*#`\-][^\n]*)\n:[ \t]+([^\n]+)/g,
    (_, prefix, term, def) => {
      return `${prefix}**${String(term).trim()}**: ${String(def).trim()}`
    },
  )

  // 还原代码占位 — 占位前缀足够独特,不强制要求两侧空格
  // (<details> 内容 trim 时可能把占位符两侧空格削掉)
  out = out.replace(/ ?ICODEXY(\d+)XYEND ?/g, (_, i) => inlineCode[+i])
  out = out.replace(/ ?FENCEDXY(\d+)XYEND ?/g, (_, i) => fenced[+i])

  return out
}

// FORK: 2026-05-08 v3 — LaTeX → MathML → OMML 嵌入 docx,Word 原生数学公式
// 路线:KaTeX renderToString(output:'mathml') → MathML 字符串
//      → mathml2omml 转 OMML 字符串
//      → 预处理:存到 mathRegistry,markdown 里用 sentinel 占位
//      → 后处理 docx XML:扫含 sentinel 的段,替换为 <m:oMathPara>(块) / <m:oMath>(行内)
//      → docx root 添加 m: namespace 声明
// 优:Word 原生公式(可编辑、矢量、跟随字号);KaTeX 已成熟支持 200+ LaTeX 命令含矩阵

import katex from "katex"
import { mml2omml } from "mathml2omml"

// 模块级 registry:sentinel id → OMML 字符串
const mathRegistry = new Map<string, { omml: string; isBlock: boolean }>()
let mathSeq = 0

// sentinel 用 PUA 字符 + ID,marked 当文本透传
const MATH_SENTINEL_OPEN = String.fromCharCode(0xe150)
const MATH_SENTINEL_CLOSE = String.fromCharCode(0xe151)

/** LaTeX → MathML 字符串(提取 KaTeX 输出里的 inner <math>) */
function latexToMathML(latex: string, displayMode: boolean): string | null {
  try {
    const html = katex.renderToString(latex, {
      output: "mathml",
      displayMode,
      throwOnError: false,
      strict: "ignore" as never,
    })
    // KaTeX mathml output 包在 <span class="katex">...<math>...</math>...</span>
    // 提取 inner <math> 元素
    const m = html.match(/<math\b[\s\S]*?<\/math>/)
    return m?.[0] ?? null
  } catch {
    return null
  }
}

/** MathML → OMML 字符串(已含 <m:oMath> 包裹)
 *  注:KaTeX `\int_0^∞` 等转 OMML 后,<m:nary> base <m:e/> 为空 — Word 渲染显示"待输入"占位框
 *  尝试过两种修补(rewrite 成 sSubSup / 吃 sibling 进 m:e),都让 docx XML 不合法 Word 拒打开
 *  接受占位作为已知小问题:user 可在 Word 内手动选中虚线框删除(Backspace),OMML 仍合法
 */
function mathmlToOmmlString(mathml: string): string | null {
  try {
    const result = mml2omml(mathml)
    return result || null
  } catch {
    return null
  }
}

/** 预处理:把 markdown 里的 $$...$$ + $...$ 转 OMML 存 registry,源文用 sentinel 占位
 *  后处理 docx XML 时按 sentinel id 取出 OMML 嵌入
 */
async function inlineKatexPngs(md: string, _viewerEl?: HTMLElement): Promise<string> {
  // 重置 registry(每次导出独立)
  mathRegistry.clear()
  mathSeq = 0

  type MathLoc = { kind: "block" | "inline"; latex: string; raw: string; idx: number }
  const locs: MathLoc[] = []
  const blockRe = /\$\$([\s\S]+?)\$\$/g
  for (const m of md.matchAll(blockRe)) {
    locs.push({ kind: "block", latex: m[1].trim(), raw: m[0], idx: m.index! })
  }
  const inlineRe = /(?<!\$)\$(?!\$)((?:[^$\\\n]|\\.)+?)\$(?!\$)/g
  for (const m of md.matchAll(inlineRe)) {
    const start = m.index!
    const end = start + m[0].length
    const overlap = locs.some((l) => start < l.idx + l.raw.length && end > l.idx)
    if (!overlap) locs.push({ kind: "inline", latex: m[1], raw: m[0], idx: start })
  }
  if (locs.length === 0) return md
  locs.sort((a, b) => a.idx - b.idx)

  let okCount = 0
  let failReason = ""

  // 倒序替换避免 idx 漂移
  let out = md
  for (let i = locs.length - 1; i >= 0; i--) {
    const loc = locs[i]
    const mathml = latexToMathML(loc.latex, loc.kind === "block")
    if (!mathml) {
      if (!failReason) failReason = `KaTeX MathML 失败: ${loc.latex.slice(0, 30)}`
      continue
    }
    const omml = mathmlToOmmlString(mathml)
    if (!omml) {
      if (!failReason) failReason = `MathML→OMML 失败: ${loc.latex.slice(0, 30)}`
      continue
    }
    const id = `M${mathSeq++}`
    mathRegistry.set(id, { omml, isBlock: loc.kind === "block" })
    okCount++
    // 用 sentinel 包 ID 占位 markdown,marked 透传到 docx <w:t>
    // 块级前后加空行让 marked 当独立 paragraph
    const sentinel = `${MATH_SENTINEL_OPEN}${id}${MATH_SENTINEL_CLOSE}`
    const replacement = loc.kind === "block" ? `\n\n${sentinel}\n\n` : sentinel
    out = out.slice(0, loc.idx) + replacement + out.slice(loc.idx + loc.raw.length)
  }

  if (okCount < locs.length) {
    showToast({
      variant: "error",
      title: `数学公式 OMML:${okCount}/${locs.length} 成功`,
      description: failReason || "(no error)",
    })
  }
  return out
}

/** 后处理 docx XML:扫所有 <w:p>,找含 math sentinel 的段,替换为 OMML 元素
 *  - block 公式:整个 <w:p> 替换为 <w:p><m:oMathPara><m:oMath>OMML</m:oMath></m:oMathPara></w:p>
 *  - inline 公式:在 paragraph 内把 <w:r>...sentinel...</w:r> 替换成 <m:oMath>OMML</m:oMath>
 *  - root <w:document> 加 m: namespace 声明
 */
// FORK: export for unit tests 2026-05-08
export function applyMathSentinels(docXml: string): string {
  if (mathRegistry.size === 0) return docXml

  let out = docXml

  // 1. 加 m: namespace 声明(若未声明)
  if (!/xmlns:m="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/math"/.test(out)) {
    out = out.replace(
      /<w:document\b([^>]*)>/,
      (m, attrs) =>
        `<w:document${attrs} xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">`,
    )
  }

  // 2. 找所有 <w:p> 段,处理含 sentinel 的
  const sentinelPattern = new RegExp(
    `${MATH_SENTINEL_OPEN}(M\\d+)${MATH_SENTINEL_CLOSE}`,
    "g",
  )
  out = out.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paraXml) => {
    if (!paraXml.includes(MATH_SENTINEL_OPEN)) return paraXml

    // 收集段内所有 sentinel(可能多个 inline,或单个 block)
    const allText = [...paraXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((m) => m[1])
      .join("")
    const sentinels = [...allText.matchAll(sentinelPattern)].map((m) => m[1])
    if (sentinels.length === 0) return paraXml

    // 检测是否为"独立块公式段":整段文本去除 sentinel 后无实质内容
    const stripped = allText.replace(sentinelPattern, "").trim()
    const isBlockOnly =
      sentinels.length === 1 && stripped === "" && mathRegistry.get(sentinels[0])?.isBlock

    if (isBlockOnly) {
      // 整段替换为 <w:p><m:oMathPara>...</m:oMathPara></w:p>
      // 注:mml2omml 输出已含 <m:oMath xmlns:m="...">...</m:oMath> wrapper,直接放进 oMathPara
      const id = sentinels[0]
      const entry = mathRegistry.get(id)
      if (!entry) return paraXml
      const pPrMatch = paraXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)
      const pPr = pPrMatch ? pPrMatch[0] : ""
      return `<w:p>${pPr}<m:oMathPara>${entry.omml}</m:oMathPara></w:p>`
    }

    // inline:把含 sentinel 的 <w:r>...</w:r> 替换成 <m:oMath>OMML</m:oMath>
    // 简单实现:扫 <w:r>,若含 sentinel,切分文本 + 插 OMML
    return paraXml.replace(
      /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g,
      (runXml) => {
        const tMatch = runXml.match(/(<w:t[^>]*>)([\s\S]*?)<\/w:t>/)
        if (!tMatch) return runXml
        const text = tMatch[2]
        if (!text.includes(MATH_SENTINEL_OPEN)) return runXml

        const rPrMatch = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
        const rPr = rPrMatch ? rPrMatch[0] : ""

        // 切分:遇到 sentinel 收尾当前 run,插 OMath,再起新 run 继续
        const parts: string[] = []
        let lastIdx = 0
        const reLocal = new RegExp(
          `${MATH_SENTINEL_OPEN}(M\\d+)${MATH_SENTINEL_CLOSE}`,
          "g",
        )
        let mm: RegExpExecArray | null
        while ((mm = reLocal.exec(text)) !== null) {
          const before = text.slice(lastIdx, mm.index)
          if (before) {
            parts.push(`<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(before)}</w:t></w:r>`)
          }
          const id = mm[1]
          const entry = mathRegistry.get(id)
          if (entry) {
            // mml2omml 输出已是 <m:oMath xmlns:m="...">...</m:oMath>,直接放入 paragraph
            parts.push(entry.omml)
          }
          lastIdx = mm.index + mm[0].length
        }
        const tail = text.slice(lastIdx)
        if (tail) {
          parts.push(`<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(tail)}</w:t></w:r>`)
        }
        return parts.join("")
      },
    )
  })

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
  // 渲染成功的图用 CENTER sentinel 包,后处理 applyCenterSentinels 给段加 <w:jc w:val="center"/>
  let idx = 0
  return md.replace(/```mermaid\n[\s\S]*?\n```/g, (matched) => {
    const png = pngs[idx++]
    if (!png) return matched
    return `\n\n${CENTER_OPEN}\n\n![Mermaid Diagram](${png})\n\n${CENTER_CLOSE}\n\n`
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

    // 2. 预处理 markdown:语法降级 → Mermaid SVG → PNG → 本地图片 base64 嵌入
    //    (emoji 不再做文本替换 — 改用 docx XML 层面的 splitRunsForEmoji,见步骤 4)
    //    远端图片不在 markdown 层处理,改在步骤 3 库的 imageAdapter 里取(绕开库的 fetch,WebView2 拦)
    let processedMd = preprocessMarkdown(opts.markdownText)
    processedMd = await inlineKatexPngs(processedMd, opts.viewerEl)
    processedMd = await inlineMermaidPngs(processedMd, opts.viewerEl)
    processedMd = await inlineLocalImages(processedMd, opts.mdFileDir)

    // 3. markdown → docx — 用 imageAdapter 绕开库 fetch,所有图片(http/https + data:)走自己解码
    const remoteFails: Array<{ url: string; reason: string }> = []
    const imageAdapter = buildImageAdapter({
      fetchUrl: (url) => invoke<string>("fetch_url_base64", { url }),
      onFail: (url, err) => {
        const reason = err instanceof Error ? err.message : String(err)
        remoteFails.push({ url, reason })
        // eslint-disable-next-line no-console
        console.error("[md-export-docx] image fetch fail:", url, err)
      },
    })
    const doc = await markdownDocx(processedMd, {
      codeHighlight: {
        enabled: true,
        theme: "github-light", // 浅色主题更适合 Word 打印
      },
      imageAdapter,
    } as any) // imageAdapter 在 lib 类型里有但当前 import 链路 cast 简化
    if (remoteFails.length > 0) {
      showToast({
        variant: "error",
        title: `远端图片获取失败 (${remoteFails.length})`,
        description: remoteFails.slice(0, 2).map((f) => `${f.url}: ${f.reason}`).join("\n"),
      })
    }

    // 4. 序列化 → 多重 post-process → 写盘
    //    顺序:代码块段合并 → inline code 改底色 → <u> sentinel 应用 → 颜色徽章 sentinel 应用
    //         → blockquote 段间距清零 → emoji run 切分(最后,因前几步可能新插 run)
    // 注:Packer.toBuffer() Node-only,浏览器报"nodebuffer is not supported";用 toBase64String + atob/btoa 转字节
    const base64Original = await Packer.toBase64String(doc)
    const zipObj = unzipSync(base64ToBytes(base64Original))
    let docXml = strFromU8(zipObj["word/document.xml"])
    docXml = mergeCodeBlockParagraphs(docXml)
    docXml = styleInlineCode(docXml)
    docXml = applyUnderlineSentinels(docXml)
    docXml = applyColorBadgeSentinels(docXml)
    docXml = applyCenterSentinels(docXml)
    // applyBlockquoteGroups 先:group 内的 table 原样保留(OOXML 不支持 table 嵌入 BQ 容器,接受现实)
    // applyTableSpacing 后:在 table 后加 spacer p 给间距,此 spacer 不会被 group 吸收(group 已处理完)
    docXml = applyBlockquoteGroups(docXml)
    docXml = applyTableBorders(docXml)
    docXml = applyTableHeaderShading(docXml)
    docXml = applyTableSpacing(docXml)
    // 数学公式:把 sentinel 占位段替换为 <m:oMath> OMML 元素,Word 原生公式
    docXml = applyMathSentinels(docXml)
    docXml = splitRunsForEmoji(docXml)

    // heading 加 bookmark + #anchor 链接转内部跳转 — 处理 docXml + _rels 双文件
    const relsPath = "word/_rels/document.xml.rels"
    if (zipObj[relsPath]) {
      const relsXml = strFromU8(zipObj[relsPath])
      const result = applyHeadingBookmarksAndAnchors(docXml, relsXml)
      docXml = result.docXml
      zipObj[relsPath] = strToU8(result.relsXml)
    }

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
// FORK: export for unit tests(R5 测试纪律 / 关键模块清单)2026-05-07
export function friendlyError(raw: string): string {
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
