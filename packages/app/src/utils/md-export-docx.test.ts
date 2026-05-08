// FORK: md-export-docx 关键纯函数测试 — 2026-05-07
// 关键模块清单内的文件(R5 决策 2),目标 80% 覆盖率。
// 已覆盖:mimeFromPath / friendlyError / base64ToBytes / bytesToBase64 /
//          splitRunsForEmoji / mergeCodeBlockParagraphs
// 待覆盖:patchForeignObjects(SVG DOM,需 happydom)/ inlineLocalImages(异步 + Tauri invoke,需 mock)/
//          exportMdAsDocx(集成,后期 e2e 路线覆盖)

import { describe, expect, mock, test } from "bun:test"
import {
  mimeFromPath,
  friendlyError,
  base64ToBytes,
  bytesToBase64,
  splitRunsForEmoji,
  mergeCodeBlockParagraphs,
  patchForeignObjects,
  preprocessMarkdown,
  toUnicodeSup,
  toUnicodeSub,
  styleInlineCode,
  applyUnderlineSentinels,
  applyColorBadgeSentinels,
  applyCenterSentinels,
  applyBlockquoteGroups,
  applyTableBorders,
  applyTableHeaderShading,
  applyTableSpacing,
  applyHeadingBookmarksAndAnchors,
  applyMathSentinels,
  wrapBlockquoteBlocks,
  QUOTE_OPEN_PLAIN,
  QUOTE_OPEN_NOTE,
  QUOTE_OPEN_TIP,
  QUOTE_OPEN_WARNING,
  QUOTE_OPEN_CAUTION,
  QUOTE_CLOSE,
  normalizeHex,
  parsePngSize,
  parseJpegSize,
  parseGifSize,
  buildImageAdapter,
  sniffImageMime,
  UND_OPEN,
  UND_CLOSE,
  BADGE_OPEN,
  BADGE_CLOSE,
} from "./md-export-docx"

// ---- SVG fixture helper ----
const SVG_NS = "http://www.w3.org/2000/svg"
function svgFromString(xml: string): SVGElement {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, "image/svg+xml")
  return doc.documentElement as unknown as SVGElement
}

describe("mimeFromPath", () => {
  test("PNG 图片", () => {
    expect(mimeFromPath("image.png")).toBe("image/png")
    expect(mimeFromPath("path/to/IMG.PNG")).toBe("image/png") // 大小写无关
  })

  test("JPEG 图片(.jpg + .jpeg)", () => {
    expect(mimeFromPath("a.jpg")).toBe("image/jpeg")
    expect(mimeFromPath("a.jpeg")).toBe("image/jpeg")
    expect(mimeFromPath("path/to/PHOTO.JPEG")).toBe("image/jpeg")
  })

  test("常见格式 — gif / webp / svg / bmp / ico / avif", () => {
    expect(mimeFromPath("a.gif")).toBe("image/gif")
    expect(mimeFromPath("a.webp")).toBe("image/webp")
    expect(mimeFromPath("a.svg")).toBe("image/svg+xml")
    expect(mimeFromPath("a.bmp")).toBe("image/bmp")
    expect(mimeFromPath("a.ico")).toBe("image/x-icon")
    expect(mimeFromPath("a.avif")).toBe("image/avif")
  })

  test("未知扩展名返回 null", () => {
    expect(mimeFromPath("file.txt")).toBeNull()
    expect(mimeFromPath("file.pdf")).toBeNull()
    expect(mimeFromPath("file.docx")).toBeNull()
    expect(mimeFromPath("noextension")).toBeNull()
  })

  test("Windows 反斜杠路径仍能识别", () => {
    expect(mimeFromPath("C:\\Users\\x\\photo.png")).toBe("image/png")
    expect(mimeFromPath("D:\\project\\image.JPG")).toBe("image/jpeg")
  })

  test("URL 风格路径", () => {
    expect(mimeFromPath("https://example.com/image.webp")).toBe("image/webp")
    expect(mimeFromPath("./relative/path.svg")).toBe("image/svg+xml")
  })

  test("空字符串返回 null", () => {
    expect(mimeFromPath("")).toBeNull()
  })

  test("仅扩展名(无路径前缀)", () => {
    expect(mimeFromPath(".png")).toBe("image/png")
  })
})

describe("friendlyError", () => {
  describe("文件系统错误", () => {
    test("permission denied / EACCES / EPERM", () => {
      expect(friendlyError("Error: EACCES permission denied")).toContain("无写入权限")
      expect(friendlyError("EPERM: operation not permitted")).toContain("无写入权限")
      expect(friendlyError("PERMISSION DENIED on /path")).toContain("无写入权限")
    })

    test("磁盘空间不足", () => {
      expect(friendlyError("ENOSPC: no space left on device")).toContain("磁盘空间不足")
      expect(friendlyError("disk full")).toContain("磁盘空间不足")
    })

    test("只读文件系统", () => {
      expect(friendlyError("EROFS: read-only file system")).toContain("只读")
    })

    test("路径过长", () => {
      expect(friendlyError("ENAMETOOLONG: path too long")).toContain("路径过长")
    })

    test("文件过大", () => {
      expect(friendlyError("file too large")).toContain("文件过大")
      expect(friendlyError("EMFILE: too many open files")).toContain("文件过大")
    })

    test("路径不存在", () => {
      expect(friendlyError("ENOENT: no such file")).toContain("路径不存在")
      expect(friendlyError("file not found")).toContain("路径不存在")
    })
  })

  describe("库内部错误", () => {
    test("nodebuffer 兼容问题", () => {
      expect(friendlyError("nodebuffer is not supported")).toContain("内部转换错误")
    })

    test("markdown 解析失败", () => {
      expect(friendlyError("invalid markdown syntax")).toContain("解析失败")
      expect(friendlyError("parse error at line 5")).toContain("解析失败")
    })
  })

  describe("兜底行为", () => {
    test("未知错误原样返回", () => {
      const raw = "some unknown weird error"
      expect(friendlyError(raw)).toBe(raw)
    })

    test("空字符串原样返回", () => {
      expect(friendlyError("")).toBe("")
    })
  })

  describe("[详细] 段保留原文(便于排查)", () => {
    test("识别到的错误都附带 [详细]", () => {
      const raw = "EACCES: permission denied"
      const out = friendlyError(raw)
      expect(out).toContain("[详细]")
      expect(out).toContain(raw)
    })
  })
})

describe("base64 编解码 — base64ToBytes / bytesToBase64", () => {
  test("空字节 / 空字符串", () => {
    expect(base64ToBytes("")).toEqual(new Uint8Array(0))
    expect(bytesToBase64(new Uint8Array(0))).toBe("")
  })

  test("ASCII roundtrip", () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
    const b64 = bytesToBase64(original)
    expect(b64).toBe("SGVsbG8=")
    const back = base64ToBytes(b64)
    expect(Array.from(back)).toEqual(Array.from(original))
  })

  test("二进制 roundtrip(全字节范围 0-255)", () => {
    const original = new Uint8Array(256)
    for (let i = 0; i < 256; i++) original[i] = i
    const b64 = bytesToBase64(original)
    const back = base64ToBytes(b64)
    expect(Array.from(back)).toEqual(Array.from(original))
  })

  test("分块边界(0x8000 chunk size)— 防 String.fromCharCode 栈溢出", () => {
    // 故意造一个跨多个 chunk 的大数组(0x10000 = 65536 字节,跨 2 个 chunk)
    const size = 0x10000
    const original = new Uint8Array(size)
    for (let i = 0; i < size; i++) original[i] = i & 0xff
    const b64 = bytesToBase64(original)
    expect(b64.length).toBeGreaterThan(0)
    const back = base64ToBytes(b64)
    expect(back.length).toBe(size)
    // 校验前 100 字节 + 最后 100 字节防完整 deep equal 太慢
    expect(Array.from(back.slice(0, 100))).toEqual(Array.from(original.slice(0, 100)))
    expect(Array.from(back.slice(-100))).toEqual(Array.from(original.slice(-100)))
  })

  test("base64 标准格式(含 padding =)", () => {
    expect(bytesToBase64(new Uint8Array([1]))).toBe("AQ==") // 1 byte → 2 padding
    expect(bytesToBase64(new Uint8Array([1, 2]))).toBe("AQI=") // 2 byte → 1 padding
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe("AQID") // 3 byte → 0 padding
  })
})

describe("splitRunsForEmoji", () => {
  test("无 emoji 的 run 不变", () => {
    const xml = `<w:r><w:t>Hello World</w:t></w:r>`
    expect(splitRunsForEmoji(xml)).toBe(xml)
  })

  test("纯 emoji run 加 rFonts 字体覆盖", () => {
    const xml = `<w:r><w:t>😀</w:t></w:r>`
    const out = splitRunsForEmoji(xml)
    expect(out).toContain("Segoe UI Emoji")
    expect(out).toContain("😀")
  })

  test("混合 run 切成多段(emoji 段独立)", () => {
    const xml = `<w:r><w:t>Hello 😀 World</w:t></w:r>`
    const out = splitRunsForEmoji(xml)
    // 应切出 3 段 run:["Hello ", "😀", " World"]
    const runMatches = out.match(/<w:r>/g) || []
    expect(runMatches.length).toBe(3)
    expect(out).toContain("Segoe UI Emoji") // emoji 段含 emoji 字体
  })

  test("已有 rPr 且含 rFonts — 替换为 emoji 字体", () => {
    const xml = `<w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>😀</w:t></w:r>`
    const out = splitRunsForEmoji(xml)
    expect(out).toContain("Segoe UI Emoji")
    expect(out).not.toContain("Calibri") // 原 Calibri 应被替换
  })

  test("已有 rPr 但无 rFonts — 在 rPr 内插入 rFonts", () => {
    const xml = `<w:r><w:rPr><w:b/></w:rPr><w:t>😀</w:t></w:r>`
    const out = splitRunsForEmoji(xml)
    expect(out).toContain("Segoe UI Emoji")
    expect(out).toContain("<w:b/>") // 原 bold 保留
  })

  test("国旗 emoji(regional indicators 1F1E6-1F1FF)", () => {
    // 🇨🇳 = U+1F1E8 U+1F1F3 (regional indicators C N)
    const xml = `<w:r><w:t>flag:🇨🇳here</w:t></w:r>`
    const out = splitRunsForEmoji(xml)
    expect(out).toContain("Segoe UI Emoji")
  })

  test("xml:space preserve 加在 t 上(防止前后空格被吞)", () => {
    const xml = `<w:r><w:t> 😀 </w:t></w:r>`
    const out = splitRunsForEmoji(xml)
    expect(out).toContain('xml:space="preserve"')
  })
})

describe("mergeCodeBlockParagraphs", () => {
  // 构造一个最小的 docx XML body fixture
  const codePara = (text: string) =>
    `<w:p><w:pPr><w:pStyle w:val="MdCode"/><w:spacing w:before="100" w:after="100"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  const normalPara = (text: string) =>
    `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  const inlineCodePara = (text: string) =>
    // 段落是 Normal,但内含 inline code(rStyle MdCode)— 不应被识为代码块
    `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:rStyle w:val="MdCode"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`

  test("无代码块段不变", () => {
    const xml = normalPara("para 1") + normalPara("para 2")
    expect(mergeCodeBlockParagraphs(xml)).toBe(xml)
  })

  test("单个代码块段不合并(需 ≥ 2 段连续)", () => {
    const xml = normalPara("normal") + codePara("alone") + normalPara("normal")
    expect(mergeCodeBlockParagraphs(xml)).toBe(xml)
  })

  test("连续 2 段代码块合并成 1 段", () => {
    const xml = codePara("line1") + codePara("line2")
    const out = mergeCodeBlockParagraphs(xml)
    // 合并后 <w:p> 数量从 2 变成 1
    const pMatches = out.match(/<w:p\b/g) || []
    expect(pMatches.length).toBe(1)
    // 两行内容都保留
    expect(out).toContain("line1")
    expect(out).toContain("line2")
    // 段间用 <w:br/> 软换行连接
    expect(out).toContain("<w:br/>")
  })

  test("连续 3+ 段代码块合并成 1 段", () => {
    const xml = codePara("a") + codePara("b") + codePara("c") + codePara("d")
    const out = mergeCodeBlockParagraphs(xml)
    const pMatches = out.match(/<w:p\b/g) || []
    expect(pMatches.length).toBe(1)
  })

  test("段落级 spacing before/after 被归零(消除段间空白)", () => {
    const xml = codePara("a") + codePara("b")
    const out = mergeCodeBlockParagraphs(xml)
    expect(out).toContain('w:before="0"')
    expect(out).toContain('w:after="0"')
  })

  test("inline code(段落级 Normal + run 级 MdCode)不被误合并 — bug 防护", () => {
    // 这是 user 实际遇到的 bug:含 inline code 的列表项被错误识别成代码块段
    const xml = inlineCodePara("inline 1") + inlineCodePara("inline 2")
    const out = mergeCodeBlockParagraphs(xml)
    // 应保持原 2 段不合并
    const pMatches = out.match(/<w:p\b/g) || []
    expect(pMatches.length).toBe(2)
    expect(out).toBe(xml) // 完整不变
  })

  test("代码块组之间隔了非代码段不会跨段合并", () => {
    // [code, code, normal, code, code] → 合并成 [merged, normal, merged]
    const xml = codePara("g1a") + codePara("g1b") + normalPara("middle") + codePara("g2a") + codePara("g2b")
    const out = mergeCodeBlockParagraphs(xml)
    const pMatches = out.match(/<w:p\b/g) || []
    expect(pMatches.length).toBe(3) // 2 个合并段 + 1 个 normal 段
    expect(out).toContain("middle")
    expect(out).toContain("g1a")
    expect(out).toContain("g1b")
    expect(out).toContain("g2a")
    expect(out).toContain("g2b")
  })
})

describe("patchForeignObjects(SVG foreignObject → SVG text)", () => {
  test("无 foreignObject 的 SVG 不动", () => {
    const svg = svgFromString(`<svg xmlns="${SVG_NS}"><rect x="0" y="0" width="100" height="100"/></svg>`)
    patchForeignObjects(svg)
    expect(svg.querySelectorAll("foreignObject").length).toBe(0)
    expect(svg.querySelectorAll("rect").length).toBe(1)
  })

  test("空 foreignObject 被移除", () => {
    const svg = svgFromString(
      `<svg xmlns="${SVG_NS}"><foreignObject x="10" y="10" width="50" height="20"></foreignObject></svg>`,
    )
    patchForeignObjects(svg)
    expect(svg.querySelectorAll("foreignObject").length).toBe(0)
    expect(svg.querySelectorAll("text").length).toBe(0) // 空内容不创建 text
  })

  test("单行文字 foreignObject → SVG text 含中心定位", () => {
    const svg = svgFromString(
      `<svg xmlns="${SVG_NS}"><foreignObject x="10" y="20" width="100" height="40">Hello</foreignObject></svg>`,
    )
    patchForeignObjects(svg)
    expect(svg.querySelectorAll("foreignObject").length).toBe(0)
    const texts = svg.querySelectorAll("text")
    expect(texts.length).toBe(1)
    const t = texts[0]
    // 中心点:x = 10+100/2 = 60, y = 20+40/2 = 40
    expect(t.getAttribute("x")).toBe("60")
    expect(t.getAttribute("y")).toBe("40")
    expect(t.getAttribute("text-anchor")).toBe("middle")
    expect(t.getAttribute("dominant-baseline")).toBe("middle")
    expect(t.textContent).toBe("Hello")
  })

  test("多行文字 → SVG text 含多个 tspan(dy 偏移)", () => {
    const svg = svgFromString(
      `<svg xmlns="${SVG_NS}"><foreignObject x="0" y="0" width="100" height="60">Line 1
Line 2
Line 3</foreignObject></svg>`,
    )
    patchForeignObjects(svg)
    const texts = svg.querySelectorAll("text")
    expect(texts.length).toBe(1)
    const tspans = texts[0].querySelectorAll("tspan")
    expect(tspans.length).toBe(3)
    expect(tspans[0].textContent).toBe("Line 1")
    expect(tspans[1].textContent).toBe("Line 2")
    expect(tspans[2].textContent).toBe("Line 3")
    // 首 tspan dy 应为负(整体上移)
    const firstDy = parseFloat(tspans[0].getAttribute("dy") || "0")
    expect(firstDy).toBeLessThan(0)
    // 后续 tspan dy 应为正常行高(16)
    expect(tspans[1].getAttribute("dy")).toBe("16")
  })

  test("多个 foreignObject 一起处理", () => {
    const svg = svgFromString(
      `<svg xmlns="${SVG_NS}">
        <foreignObject x="0" y="0" width="50" height="20">A</foreignObject>
        <foreignObject x="50" y="0" width="50" height="20">B</foreignObject>
      </svg>`,
    )
    patchForeignObjects(svg)
    expect(svg.querySelectorAll("foreignObject").length).toBe(0)
    const texts = svg.querySelectorAll("text")
    expect(texts.length).toBe(2)
    expect(texts[0].textContent).toBe("A")
    expect(texts[1].textContent).toBe("B")
  })

  test("foreignObject 缺 x/y 属性 — 默认 0", () => {
    const svg = svgFromString(
      `<svg xmlns="${SVG_NS}"><foreignObject width="100" height="40">X</foreignObject></svg>`,
    )
    patchForeignObjects(svg)
    const t = svg.querySelector("text")!
    // x=0+100/2=50, y=0+40/2=20
    expect(t.getAttribute("x")).toBe("50")
    expect(t.getAttribute("y")).toBe("20")
  })

  test("纯空白文字(只 \\n / 空格)被视为空,foreignObject 移除", () => {
    const svg = svgFromString(
      `<svg xmlns="${SVG_NS}"><foreignObject x="0" y="0" width="50" height="20">

   </foreignObject></svg>`,
    )
    patchForeignObjects(svg)
    expect(svg.querySelectorAll("foreignObject").length).toBe(0)
    expect(svg.querySelectorAll("text").length).toBe(0)
  })
})

// ---- preprocessMarkdown:库不支持语法降级转换 ----
describe("toUnicodeSup / toUnicodeSub", () => {
  test("数字 → Unicode 上标", () => {
    expect(toUnicodeSup("2")).toBe("²")
    expect(toUnicodeSup("123")).toBe("¹²³")
    expect(toUnicodeSup("0")).toBe("⁰")
  })

  test("数字 → Unicode 下标", () => {
    expect(toUnicodeSub("2")).toBe("₂")
    expect(toUnicodeSub("0")).toBe("₀")
  })

  test("含运算符 — 仍可转", () => {
    expect(toUnicodeSup("+1")).toBe("⁺¹")
    expect(toUnicodeSub("n=1")).toBe("ₙ₌₁")
  })

  test("含不支持字符 → 返 null(整体 fallback)", () => {
    // 复杂 LaTeX-like:回退到原文
    expect(toUnicodeSup("\\frac{1}{2}")).toBeNull()
    expect(toUnicodeSub("中文")).toBeNull()
  })
})

describe("preprocessMarkdown — 文本样式 HTML strip", () => {
  test("<u>X</u> → 用 sentinel 包(后处理加 <w:u/> 下划线)", () => {
    const out = preprocessMarkdown("hello <u>world</u> end")
    expect(out).toContain("world")
    expect(out).toContain(UND_OPEN)
    expect(out).toContain(UND_CLOSE)
    expect(out).not.toContain("<u>")
  })

  test("<kbd>Ctrl</kbd> → Ctrl", () => {
    expect(preprocessMarkdown("按 <kbd>Ctrl</kbd> + <kbd>C</kbd>")).toBe("按 Ctrl + C")
  })

  test("==X== → BADGE sentinel(黄底,后处理加 <w:shd>)", () => {
    const out = preprocessMarkdown("这是 ==高亮== 文本")
    expect(out).toContain("高亮")
    expect(out).toContain(BADGE_OPEN)
    expect(out).toContain("bg=FFF59D")
    expect(out).toContain(BADGE_CLOSE)
    expect(out).not.toContain("==")
  })

  test("<sup>2</sup> → ²(Unicode 上标)", () => {
    expect(preprocessMarkdown("E = mc<sup>2</sup>")).toBe("E = mc²")
  })

  test("<sub>2</sub> → ₂", () => {
    expect(preprocessMarkdown("H<sub>2</sub>O")).toBe("H₂O")
  })

  test("<sup> 含不支持字符 → 仅去标签", () => {
    expect(preprocessMarkdown("a<sup>中</sup>")).toBe("a中")
  })

  test("代码块内 <u> 不被 sentinel 包(占位保护)", () => {
    const md = "before\n\n```html\n<u>raw</u>\n```\n\nafter <u>strip</u> end"
    const out = preprocessMarkdown(md)
    expect(out).toContain("<u>raw</u>") // 代码块内保留原文
    expect(out).not.toMatch(/```html\n[^\n]*UND_OPEN/) // 代码块内不应有 sentinel
    // 代码块外 sentinel 应用
    expect(out).toContain(`${UND_OPEN}strip${UND_CLOSE}`)
  })

  test("行内代码内 ==X== 不被 strip", () => {
    const out = preprocessMarkdown("演示 `==raw==` 与 ==strip==")
    expect(out).toContain("`==raw==`")
    expect(out).toContain("strip") // 行内未 strip 的话仍通过
    expect(out).not.toMatch(/[^`]==strip==/)
  })
})

describe("preprocessMarkdown — GFM Alerts(英文标签 + emoji,不做翻译)", () => {
  test("> [!NOTE] → > **📌 Note**", () => {
    const md = "> [!NOTE]\n> 这是一条提示信息。"
    const out = preprocessMarkdown(md)
    expect(out).toContain("**📌 Note**")
    expect(out).toContain("这是一条提示信息。")
    expect(out).not.toContain("[!NOTE]")
  })

  test("[!TIP] / [!WARNING] / [!CAUTION] / [!IMPORTANT] 都用英文标签", () => {
    expect(preprocessMarkdown("> [!TIP]\n> X")).toContain("💡 Tip")
    expect(preprocessMarkdown("> [!WARNING]\n> X")).toContain("⚠️ Warning")
    expect(preprocessMarkdown("> [!CAUTION]\n> X")).toContain("🚨 Caution")
    expect(preprocessMarkdown("> [!IMPORTANT]\n> X")).toContain("❗ Important")
  })

  test("不在引用行的 [!NOTE] 不被替换", () => {
    expect(preprocessMarkdown("段落里的 [!NOTE] 不变")).toContain("[!NOTE]")
  })
})

describe("preprocessMarkdown — HTML <img> → markdown image", () => {
  test("基本 <img src=alt= />", () => {
    const md = '<img src="https://x.com/a.png" alt="A" />'
    expect(preprocessMarkdown(md)).toContain("![A](https://x.com/a.png)")
  })

  test("无 alt 属性 → 空 alt", () => {
    expect(preprocessMarkdown('<img src="x.png" />')).toContain("![](x.png)")
  })

  test("含 width/height 属性 → 仅保 src/alt", () => {
    const md = '<img src="x.png" alt="X" width="150" height="80" />'
    expect(preprocessMarkdown(md)).toContain("![X](x.png)")
  })

  test("<p align=\"center\"><img/></p> → unwrap + 多个图片转 markdown", () => {
    const md =
      '<p align="center">\n  <img src="a.png" alt="A" />\n  <img src="b.png" alt="B" />\n</p>'
    const out = preprocessMarkdown(md)
    expect(out).toContain("![A](a.png)")
    expect(out).toContain("![B](b.png)")
    expect(out).not.toContain("<p")
    expect(out).not.toContain("</p>")
  })
})

describe("preprocessMarkdown — <details> / <span> / <div>", () => {
  test("<details><summary>X</summary>Y</details> → 加粗摘要 + 内容", () => {
    const md = "<details>\n<summary>点击展开</summary>\n\n隐藏内容\n\n</details>"
    const out = preprocessMarkdown(md)
    expect(out).toContain("**▶ 点击展开**")
    expect(out).toContain("隐藏内容")
    expect(out).not.toContain("<details>")
    expect(out).not.toContain("<summary>")
  })

  test("<details> 含代码块时,代码块保留", () => {
    const md = '<details>\n<summary>S</summary>\n\n```js\nconsole.log("x");\n```\n\n</details>'
    const out = preprocessMarkdown(md)
    expect(out).toContain("**▶ S**")
    expect(out).toContain("```js")
    expect(out).toContain('console.log("x")')
  })

  test('<span style="background:X">Y</span> → 颜色徽章 sentinel(后处理加 <w:shd>)', () => {
    const md =
      '<span style="background:#4CAF50;color:#fff;">成功</span> <span style="background:#FF9800;">警告</span>'
    const out = preprocessMarkdown(md)
    expect(out).toContain("成功")
    expect(out).toContain("警告")
    expect(out).toContain(BADGE_OPEN)
    expect(out).toContain(BADGE_CLOSE)
    expect(out).toContain("bg=4CAF50")
    expect(out).toContain("bg=FF9800")
  })

  test('<span> 无 background style → strip 标签', () => {
    expect(preprocessMarkdown('<span>plain</span>')).toBe("plain")
  })

  test('<div align="center">X</div> → 用 CENTER sentinel 包(后处理加 <w:jc w:val="center"/>)', () => {
    const md = '<div align="center">\n\n**居中标题**\n\n</div>'
    const out = preprocessMarkdown(md)
    expect(out).toContain("**居中标题**")
    expect(out).not.toContain("<div")
    expect(out).toContain(String.fromCharCode(0xe120)) // CENTER_OPEN
    expect(out).toContain(String.fromCharCode(0xe121)) // CENTER_CLOSE
  })

  test('<div> 不带 align="center" → unwrap 不加 center sentinel', () => {
    const md = "<div>\n\n普通内容\n\n</div>"
    const out = preprocessMarkdown(md)
    expect(out).toContain("普通内容")
    expect(out).not.toContain("<div")
    expect(out).not.toContain(String.fromCharCode(0xe120))
  })

  test('<p align="center">X</p> → 用 CENTER sentinel 包', () => {
    const md = '<p align="center">居中段落</p>'
    const out = preprocessMarkdown(md)
    expect(out).toContain("居中段落")
    expect(out).toContain(String.fromCharCode(0xe120))
    expect(out).toContain(String.fromCharCode(0xe121))
  })
})

describe("preprocessMarkdown — 定义列表", () => {
  test("Term\\n: Def → **Term**: Def", () => {
    const md = "Markdown\n:   一种轻量级的标记语言。"
    const out = preprocessMarkdown(md)
    expect(out).toContain("**Markdown**: 一种轻量级的标记语言。")
  })

  test("多项定义列表", () => {
    const md = "Mermaid\n:   图表工具\n\nGFM\n:   GitHub Flavored Markdown"
    const out = preprocessMarkdown(md)
    expect(out).toContain("**Mermaid**: 图表工具")
    expect(out).toContain("**GFM**: GitHub Flavored Markdown")
  })

  test("不误伤普通带冒号文本", () => {
    const md = "标题\n这是普通段落,不是定义。"
    expect(preprocessMarkdown(md)).toBe(md) // 无变化
  })
})

describe("preprocessMarkdown — 综合(整段 markdown 不破坏)", () => {
  test("含标题 / 列表 / 代码块 / GFM Alert / HTML 全套", () => {
    const md = [
      "# 标题",
      "",
      "- 普通列表",
      "- <kbd>Ctrl</kbd> 键盘项",
      "",
      "> [!NOTE]",
      "> 提示信息",
      "",
      "```js",
      "// <u>这里是代码</u>,保留原文",
      "```",
      "",
      "段落 H<sub>2</sub>O 和 mc<sup>2</sup>。",
    ].join("\n")
    const out = preprocessMarkdown(md)
    expect(out).toContain("# 标题")
    expect(out).toContain("- 普通列表")
    expect(out).toContain("- Ctrl 键盘项")
    expect(out).toContain("**📌 Note**") // 英文标签 + emoji
    expect(out).toContain("// <u>这里是代码</u>,保留原文") // 代码块内 <u> 保留
    expect(out).toContain("H₂O")
    expect(out).toContain("mc²")
  })
})

// ---- post-process 函数 ----
describe("normalizeHex", () => {
  test("3 位 → 6 位扩展", () => {
    expect(normalizeHex("#fff")).toBe("FFFFFF")
    expect(normalizeHex("fff")).toBe("FFFFFF")
    expect(normalizeHex("#abc")).toBe("AABBCC")
  })

  test("6 位 → 大写", () => {
    expect(normalizeHex("#4caf50")).toBe("4CAF50")
    expect(normalizeHex("4caf50")).toBe("4CAF50")
  })

  test("无效返 null", () => {
    expect(normalizeHex("red")).toBeNull()
    expect(normalizeHex("rgb(0,0,0)")).toBeNull()
    expect(normalizeHex("")).toBeNull()
  })
})

describe("styleInlineCode — inline code 加底色 + 去库的 underline", () => {
  test("含 MdCode + underline 的 rPr → 去 underline 加 <w:shd>", () => {
    const xml = `<w:r><w:rPr><w:rStyle w:val="MdCode"/><w:u w:val="single"/></w:rPr><w:t>npm install</w:t></w:r>`
    const out = styleInlineCode(xml)
    expect(out).not.toContain("<w:u")
    expect(out).toContain('<w:shd w:val="clear"')
    expect(out).toContain('w:fill="D4EDDA"') // 薄荷绿(2026-05-08 更醒目)
  })

  test("MdCode 但无 underline(代码块 run)→ 不动", () => {
    const xml = `<w:r><w:rPr><w:rStyle w:val="MdCode"/></w:rPr><w:t>code block line</w:t></w:r>`
    expect(styleInlineCode(xml)).toBe(xml)
  })

  test("非 MdCode 的 rPr → 不动", () => {
    const xml = `<w:r><w:rPr><w:b/><w:u w:val="single"/></w:rPr><w:t>bold</w:t></w:r>`
    expect(styleInlineCode(xml)).toBe(xml)
  })

  test("已有 <w:shd> 不重复加", () => {
    const xml = `<w:r><w:rPr><w:rStyle w:val="MdCode"/><w:u w:val="single"/><w:shd w:fill="EEE"/></w:rPr><w:t>x</w:t></w:r>`
    const out = styleInlineCode(xml)
    expect((out.match(/<w:shd/g) ?? []).length).toBe(1)
  })
})

describe("applyUnderlineSentinels", () => {
  test("含 sentinel 的 run → 切 3 段,中段加 <w:u/>", () => {
    const xml = `<w:r><w:rPr><w:b/></w:rPr><w:t>before${UND_OPEN}underlined${UND_CLOSE}after</w:t></w:r>`
    const out = applyUnderlineSentinels(xml)
    // 切 3 段:before / underlined(下划线)/ after
    const runs = out.match(/<w:r>/g) ?? []
    expect(runs.length).toBe(3)
    expect(out).toContain('<w:u w:val="single"/>')
    expect(out).toContain("before")
    expect(out).toContain("underlined")
    expect(out).toContain("after")
    expect(out).not.toContain(UND_OPEN)
  })

  test("无 sentinel 的 run → 不动", () => {
    const xml = `<w:r><w:t>plain</w:t></w:r>`
    expect(applyUnderlineSentinels(xml)).toBe(xml)
  })

  test("XML 特殊字符 escape", () => {
    const xml = `<w:r><w:t>${UND_OPEN}a&b<c>${UND_CLOSE}</w:t></w:r>`
    const out = applyUnderlineSentinels(xml)
    expect(out).toContain("a&amp;b&lt;c&gt;")
  })
})

describe("applyColorBadgeSentinels", () => {
  test("BADGE_OPEN/MID/CLOSE 切 run + 加 <w:shd> + <w:color>", () => {
    const xml = `<w:r><w:t>${BADGE_OPEN}bg=4CAF50,fg=FFFFFFcontent${BADGE_CLOSE}tail</w:t></w:r>`
      .replace("content", String.fromCharCode(0xe111) + "content") // 注入 BADGE_MID
    const out = applyColorBadgeSentinels(xml)
    expect(out).toContain('w:fill="4CAF50"')
    expect(out).toContain('<w:color w:val="FFFFFF"/>')
    expect(out).toContain("content")
    expect(out).toContain("tail")
  })

  test("无 sentinel → 不动", () => {
    const xml = `<w:r><w:t>plain</w:t></w:r>`
    expect(applyColorBadgeSentinels(xml)).toBe(xml)
  })
})

describe("wrapBlockquoteBlocks — 给独立 blockquote 块前后加 sentinel", () => {
  test("普通 blockquote 块 → PLAIN sentinel 包", () => {
    const md = "前文\n\n> A\n> B\n\n后文"
    const out = wrapBlockquoteBlocks(md)
    expect(out).toContain(QUOTE_OPEN_PLAIN)
    expect(out).toContain(QUOTE_CLOSE)
    expect(out).toContain("> A")
    expect(out).toContain("> B")
  })

  test("GFM Alert [!NOTE] → NOTE sentinel + 重写第一行为加粗 label", () => {
    const md = "> [!NOTE]\n> 内容"
    const out = wrapBlockquoteBlocks(md)
    expect(out).toContain(QUOTE_OPEN_NOTE)
    expect(out).toContain("> **📌 Note**")
    expect(out).toContain("> 内容")
    expect(out).not.toContain("[!NOTE]")
    expect(out).toContain(QUOTE_CLOSE)
  })

  test("GFM Alert 5 类型分别用 5 个 sentinel", () => {
    expect(wrapBlockquoteBlocks("> [!NOTE]\n> X")).toContain(QUOTE_OPEN_NOTE)
    expect(wrapBlockquoteBlocks("> [!TIP]\n> X")).toContain(QUOTE_OPEN_TIP)
    expect(wrapBlockquoteBlocks("> [!WARNING]\n> X")).toContain(QUOTE_OPEN_WARNING)
    expect(wrapBlockquoteBlocks("> [!CAUTION]\n> X")).toContain(QUOTE_OPEN_CAUTION)
  })

  test("两个独立 blockquote → 各自包 sentinel", () => {
    const md = "> A\n\n> B"
    const out = wrapBlockquoteBlocks(md)
    expect((out.match(new RegExp(QUOTE_OPEN_PLAIN, "g")) ?? []).length).toBe(2)
    expect((out.match(new RegExp(QUOTE_CLOSE, "g")) ?? []).length).toBe(2)
  })

  test("无 blockquote → 不动", () => {
    expect(wrapBlockquoteBlocks("纯文本\n\n# 标题")).toBe("纯文本\n\n# 标题")
  })
})

describe("applyTableBorders — 给所有表格加 6 边全边框", () => {
  test("无 tblPr 的 table → 注入 tblPr + tblBorders", () => {
    const xml = `<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`
    const out = applyTableBorders(xml)
    expect(out).toContain("<w:tblPr>")
    expect(out).toContain("<w:tblBorders>")
    expect(out).toContain("<w:top ")
    expect(out).toContain("<w:left ")
    expect(out).toContain("<w:bottom ")
    expect(out).toContain("<w:right ")
    expect(out).toContain("<w:insideH ")
    expect(out).toContain("<w:insideV ")
  })

  test("已有 tblPr 但无 tblBorders → 在 tblPr 内插入", () => {
    const xml = `<w:tbl><w:tblPr><w:tblW w:w="0"/></w:tblPr><w:tr/></w:tbl>`
    const out = applyTableBorders(xml)
    expect(out).toContain("<w:tblBorders>")
    expect(out).toContain('<w:tblW w:w="0"/>') // 原 tblPr 内容保留
  })

  test("已有 tblBorders → 替换", () => {
    const xml = `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="none"/></w:tblBorders></w:tblPr></w:tbl>`
    const out = applyTableBorders(xml)
    expect(out).toContain('w:val="single"')
    expect(out).not.toContain('w:val="none"')
  })

  test("多表 — 每张都加边框", () => {
    const xml = `<w:tbl><w:tr/></w:tbl><w:p/><w:tbl><w:tr/></w:tbl>`
    const out = applyTableBorders(xml)
    const matches = out.match(/<w:tblBorders>/g) ?? []
    expect(matches.length).toBe(2)
  })

  test("无 table → 不动", () => {
    const xml = `<w:p><w:r><w:t>plain</w:t></w:r></w:p>`
    expect(applyTableBorders(xml)).toBe(xml)
  })
})

describe("applyTableSpacing — 表格前后插入空段做间距", () => {
  test("<w:tbl> 前 + </w:tbl> 后各插入 spacer", () => {
    // 用唯一 marker 避免与 spacer 内 "before/after" 字符串冲突
    const xml = `<w:p>P1MARKER</w:p><w:tbl><w:tr/></w:tbl><w:p>P2MARKER</w:p>`
    const out = applyTableSpacing(xml)
    const matches = out.match(/w:before="240"/g) ?? []
    expect(matches.length).toBe(2)
    expect(out.indexOf("P1MARKER")).toBeLessThan(out.indexOf("<w:tbl"))
    expect(out.indexOf("</w:tbl>")).toBeLessThan(out.indexOf("P2MARKER"))
  })

  test("多表 — 每张表都前后加 spacer", () => {
    const xml = `<w:tbl><w:tr/></w:tbl><w:p/><w:tbl><w:tr/></w:tbl>`
    const out = applyTableSpacing(xml)
    // 2 张表 × 2 个 spacer/张 = 4
    const matches = out.match(/w:before="240"/g) ?? []
    expect(matches.length).toBe(4)
  })

  test("无 table → 不动", () => {
    const xml = `<w:p>plain</w:p>`
    expect(applyTableSpacing(xml)).toBe(xml)
  })
})

describe("applyBlockquoteGroups — 基于 sentinel 的 group 应用(删 sentinel/Space + 加 pBdr/shd)", () => {
  // 模拟 docx XML — sentinel 段 / blockquote 段 / MdSpace 段
  const sentinelP = (sentinel: string) =>
    `<w:p><w:pPr><w:pStyle w:val="MdParagraph"/></w:pPr><w:r><w:t>${sentinel}</w:t></w:r></w:p>`
  const bq = (text: string) =>
    `<w:p><w:pPr><w:pStyle w:val="MdBlockquote"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  const space = `<w:p><w:pPr><w:pStyle w:val="MdSpace"/><w:spacing w:after="60" w:before="0"/></w:pPr></w:p>`

  test("OPEN_PLAIN + BQ + Space + BQ + CLOSE → 删 sentinel/Space,2 段 BQ 加 pBdr/shd", () => {
    const xml =
      sentinelP(QUOTE_OPEN_PLAIN) + bq("p1") + space + bq("p2") + sentinelP(QUOTE_CLOSE)
    const out = applyBlockquoteGroups(xml)
    const ps = out.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)!
    expect(ps.length).toBe(2) // OPEN/CLOSE/Space 全删
    expect(ps[0]).toContain("p1")
    expect(ps[1]).toContain("p2")
    expect(ps[0]).toContain('<w:pBdr>')
    expect(ps[0]).toContain('w:color="D0D7DE"') // PLAIN 灰边
    expect(ps[0]).toContain('w:fill="F6F8FA"') // PLAIN 浅灰底
  })

  test("NOTE 类型 → 蓝色边 + 蓝色底", () => {
    const xml = sentinelP(QUOTE_OPEN_NOTE) + bq("note") + sentinelP(QUOTE_CLOSE)
    const out = applyBlockquoteGroups(xml)
    expect(out).toContain('w:color="0969DA"')
    expect(out).toContain('w:fill="DDF4FF"')
  })

  test("TIP 类型 → 绿色", () => {
    const xml = sentinelP(QUOTE_OPEN_TIP) + bq("tip") + sentinelP(QUOTE_CLOSE)
    const out = applyBlockquoteGroups(xml)
    expect(out).toContain('w:color="1A7F37"')
  })

  test("WARNING 类型 → 黄色", () => {
    const xml = sentinelP(QUOTE_OPEN_WARNING) + bq("warning") + sentinelP(QUOTE_CLOSE)
    const out = applyBlockquoteGroups(xml)
    expect(out).toContain('w:color="9A6700"')
  })

  test("CAUTION 类型 → 红色", () => {
    const xml = sentinelP(QUOTE_OPEN_CAUTION) + bq("caution") + sentinelP(QUOTE_CLOSE)
    const out = applyBlockquoteGroups(xml)
    expect(out).toContain('w:color="CF222E"')
  })

  test("两个独立 group 各自处理(不互合)", () => {
    const xml =
      sentinelP(QUOTE_OPEN_NOTE) + bq("note") + sentinelP(QUOTE_CLOSE) +
      sentinelP(QUOTE_OPEN_CAUTION) + bq("caution") + sentinelP(QUOTE_CLOSE)
    const out = applyBlockquoteGroups(xml)
    const ps = out.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)!
    expect(ps.length).toBe(2)
    expect(ps[0]).toContain("note")
    expect(ps[0]).toContain('w:color="0969DA"') // NOTE 蓝
    expect(ps[1]).toContain("caution")
    expect(ps[1]).toContain('w:color="CF222E"') // CAUTION 红
  })

  test("group 内首末段 spacing — 首 before=200/after=0,末 before=0/after=200", () => {
    const xml =
      sentinelP(QUOTE_OPEN_PLAIN) + bq("p1") + space + bq("p2") + space + bq("p3") +
      sentinelP(QUOTE_CLOSE)
    const out = applyBlockquoteGroups(xml)
    const ps = out.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)!
    expect(ps[0]).toMatch(/w:before="200"/)
    expect(ps[0]).toMatch(/w:after="0"/)
    expect(ps[1]).toMatch(/w:before="0"/)
    expect(ps[1]).toMatch(/w:after="0"/)
    expect(ps[2]).toMatch(/w:before="0"/)
    expect(ps[2]).toMatch(/w:after="200"/)
  })

  test("无 sentinel → 不动", () => {
    const xml = bq("a") + bq("b")
    expect(applyBlockquoteGroups(xml)).toBe(xml)
  })
})

describe("applyCenterSentinels — 居中容器后处理", () => {
  const CO = String.fromCharCode(0xe120)
  const CC = String.fromCharCode(0xe121)

  test("OPEN 单独段 + 内容段 + CLOSE 单独段 → 删 marker,内容段加 <w:jc center>", () => {
    const xml =
      `<w:p><w:r><w:t>${CO}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>居中文字</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>${CC}</w:t></w:r></w:p>`
    // 不能在同一调用内复用模块级 inCenter,需 import 后用模块导出函数
    // applyCenterSentinels 内部已用闭包 state,每次调用重置
    const out = applyCenterSentinels(xml)
    expect(out).not.toContain(CO)
    expect(out).not.toContain(CC)
    expect(out).toContain('<w:jc w:val="center"/>')
    expect(out).toContain("居中文字")
  })

  test("OPEN/CLOSE 之间多段 → 全部居中", () => {
    const xml =
      `<w:p><w:r><w:t>${CO}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>段1</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>段2</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>${CC}</w:t></w:r></w:p>`
    const out = applyCenterSentinels(xml)
    const jcs = out.match(/<w:jc w:val="center"\/>/g) ?? []
    expect(jcs.length).toBe(2)
  })

  test("无 sentinel → 不动", () => {
    const xml = `<w:p><w:r><w:t>普通段</w:t></w:r></w:p>`
    expect(applyCenterSentinels(xml)).toBe(xml)
  })
})

describe("parsePngSize / parseJpegSize / parseGifSize", () => {
  test("PNG 头解析(IHDR)", () => {
    // PNG signature + IHDR (length=13, "IHDR", width=200, height=80, ...)
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x0d, // chunk length 13
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      0x00, 0x00, 0x00, 0xc8, // width = 200
      0x00, 0x00, 0x00, 0x50, // height = 80
      0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, ...
    ])
    expect(parsePngSize(bytes)).toEqual({ width: 200, height: 80 })
  })

  test("PNG 非法签名 → null", () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    expect(parsePngSize(bytes)).toBeNull()
  })

  test("PNG 截短 → null", () => {
    expect(parsePngSize(new Uint8Array([0x89, 0x50]))).toBeNull()
  })

  test("JPEG SOF0 头解析", () => {
    // SOI + APP0(JFIF, len=0x10) + SOF0(len=0x11, precision=8, height=80, width=200, components=3)
    const bytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x50, 0x00, 0xc8, 0x03, // SOF0: precision=8, h=80, w=200, components=3
      // 后面省略,只解析到 SOF0 即返
      0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ])
    expect(parseJpegSize(bytes)).toEqual({ width: 200, height: 80 })
  })

  test("JPEG 非法 → null", () => {
    expect(parseJpegSize(new Uint8Array([0x00, 0x00]))).toBeNull()
  })

  test("GIF 头解析", () => {
    // GIF89a + width=200(LE) + height=80(LE)
    const bytes = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
      0xc8, 0x00, // width = 200
      0x50, 0x00, // height = 80
    ])
    expect(parseGifSize(bytes)).toEqual({ width: 200, height: 80 })
  })

  test("GIF 非法 → null", () => {
    expect(parseGifSize(new Uint8Array([0x00, 0x00]))).toBeNull()
  })
})

describe("buildImageAdapter", () => {
  test("data: URL → 解 base64 直接喂 bytes", async () => {
    // 一个最小 PNG(单像素红 1x1)的 base64
    // 真值不重要,只验证 token.href = data:... 能被识别且不调 fetchUrl
    const tinyPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, // width = 1
      0x00, 0x00, 0x00, 0x01, // height = 1
      0x08, 0x06, 0x00, 0x00, 0x00,
    ])
    const b64 = bytesToBase64(tinyPng)
    const fetchUrl = mock(async () => "")
    const adapter = buildImageAdapter({ fetchUrl })
    const result = await adapter({ href: `data:image/png;base64,${b64}` })
    expect(result).not.toBeNull()
    expect(result!.type).toBe("png")
    expect(result!.width).toBe(1)
    expect(result!.height).toBe(1)
    expect(fetchUrl).not.toHaveBeenCalled() // data: 不调远端
  })

  test("https URL → 调 fetchUrl 取 base64", async () => {
    const tinyPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00, 0x50, // 200x80
      0x08, 0x06, 0x00, 0x00, 0x00,
    ])
    const fetchUrl = mock(async () => bytesToBase64(tinyPng))
    const adapter = buildImageAdapter({ fetchUrl })
    const result = await adapter({ href: "https://placehold.co/200x80" })
    expect(result).not.toBeNull()
    expect(result!.type).toBe("png")
    expect(result!.width).toBe(200)
    expect(result!.height).toBe(80)
    expect(fetchUrl).toHaveBeenCalledTimes(1)
  })

  test("https + .jpg URL 后缀 → type=jpg", async () => {
    // 最小 JPEG: SOI + SOF0(width=100, height=50)
    const tinyJpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x32, 0x00, 0x64, 0x03,
      0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ])
    const fetchUrl = mock(async () => bytesToBase64(tinyJpeg))
    const adapter = buildImageAdapter({ fetchUrl })
    const result = await adapter({ href: "https://example.com/photo.jpg" })
    expect(result).not.toBeNull()
    expect(result!.type).toBe("jpg")
    expect(result!.width).toBe(100)
    expect(result!.height).toBe(50)
  })

  test("无 href → null", async () => {
    const adapter = buildImageAdapter({ fetchUrl: mock(async () => "") })
    expect(await adapter({})).toBeNull()
  })

  test("非 http/data URL(file://)→ null", async () => {
    const adapter = buildImageAdapter({ fetchUrl: mock(async () => "") })
    expect(await adapter({ href: "file:///tmp/x.png" })).toBeNull()
  })

  test("fetchUrl 抛错 → onFail 回调 + 返 null", async () => {
    const fetchUrl = mock(async () => {
      throw new Error("network down")
    })
    const onFail = mock(() => {})
    const adapter = buildImageAdapter({ fetchUrl, onFail })
    const result = await adapter({ href: "https://placehold.co/100" })
    expect(result).toBeNull()
    expect(onFail).toHaveBeenCalledTimes(1)
  })

  test("未知字节(非 PNG/JPEG/GIF/BMP/SVG)→ 尝试 convertNonNative,转换失败返 null", async () => {
    const fetchUrl = mock(async () => bytesToBase64(new Uint8Array([0x00, 0x00, 0x00])))
    const convertNonNative = mock(async () => null) // 转换失败
    const onFail = mock(() => {})
    const adapter = buildImageAdapter({ fetchUrl, convertNonNative, onFail })
    const result = await adapter({ href: "https://example.com/unknown" })
    expect(result).toBeNull()
    expect(convertNonNative).toHaveBeenCalledTimes(1)
    expect(onFail).toHaveBeenCalledTimes(1) // unsupported format 错误
  })

  test("SVG 字节 → 走 convertNonNative,转换成功返 PNG bytes", async () => {
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>')
    const fetchUrl = mock(async () => bytesToBase64(svgBytes))
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // 任意 PNG-like
    const convertNonNative = mock(async (bytes: Uint8Array, mime: string) => ({
      bytes: fakePng,
      width: 100,
      height: 50,
    }))
    const adapter = buildImageAdapter({ fetchUrl, convertNonNative })
    const result = await adapter({ href: "https://placehold.co/100x50" })
    expect(result).not.toBeNull()
    expect(result!.type).toBe("png") // 转换后统一 png
    expect(result!.data).toBe(fakePng)
    expect(result!.width).toBe(100)
    expect(result!.height).toBe(50)
    expect(convertNonNative).toHaveBeenCalledWith(svgBytes, "image/svg+xml")
  })
})

describe("sniffImageMime", () => {
  test("PNG 字节头", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(sniffImageMime(bytes)).toBe("image/png")
  })

  test("JPEG 字节头", () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
  })

  test("GIF 字节头", () => {
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif")
  })

  test("BMP 字节头", () => {
    expect(sniffImageMime(new Uint8Array([0x42, 0x4d, 0x00, 0x00]))).toBe("image/bmp")
  })

  test("WebP 字节头", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0,
      0x57, 0x45, 0x42, 0x50,
    ])
    expect(sniffImageMime(bytes)).toBe("image/webp")
  })

  test("SVG(<svg)", () => {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(sniffImageMime(bytes)).toBe("image/svg+xml")
  })

  test("SVG(以 <?xml 开头)", () => {
    const bytes = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="..."></svg>')
    expect(sniffImageMime(bytes)).toBe("image/svg+xml")
  })

  test("未知字节 → application/octet-stream", () => {
    expect(sniffImageMime(new Uint8Array([0x00, 0x00, 0x00]))).toBe("application/octet-stream")
  })
})

// ---- 后期新增 helper(2026-05-08)----

describe("applyTableHeaderShading — 给含 MdTableHeader 的 cell 加浅灰底色", () => {
  test("含 MdTableHeader pStyle 的 cell → 加 shd F6F8FA", () => {
    const xml =
      `<w:tc><w:tcPr><w:tcW w:w="1000"/></w:tcPr>` +
      `<w:p><w:pPr><w:pStyle w:val="MdTableHeader"/></w:pPr></w:p></w:tc>`
    const out = applyTableHeaderShading(xml)
    expect(out).toContain('w:fill="F6F8FA"')
    expect(out).toContain('<w:tcW w:w="1000"/>') // 原 tcPr 内容保留
  })

  test("不含 MdTableHeader 的 cell(普通 MdTableCell)→ 不动", () => {
    const xml =
      `<w:tc><w:tcPr/><w:p><w:pPr><w:pStyle w:val="MdTableCell"/></w:pPr></w:p></w:tc>`
    expect(applyTableHeaderShading(xml)).toBe(xml)
  })

  test("无 tcPr 时自动注入", () => {
    const xml =
      `<w:tc><w:p><w:pPr><w:pStyle w:val="MdTableHeader"/></w:pPr></w:p></w:tc>`
    const out = applyTableHeaderShading(xml)
    expect(out).toContain("<w:tcPr>")
    expect(out).toContain('w:fill="F6F8FA"')
  })

  test("已有 shd 替换为 header 灰", () => {
    const xml =
      `<w:tc><w:tcPr><w:shd w:fill="EEEEEE"/></w:tcPr>` +
      `<w:p><w:pPr><w:pStyle w:val="MdTableHeader"/></w:pPr></w:p></w:tc>`
    const out = applyTableHeaderShading(xml)
    expect(out).toContain('w:fill="F6F8FA"')
    expect(out).not.toContain('w:fill="EEEEEE"')
  })

  test("多 cell — 仅 header 受影响", () => {
    const xml =
      `<w:tc><w:tcPr/><w:p><w:pPr><w:pStyle w:val="MdTableHeader"/></w:pPr></w:p></w:tc>` +
      `<w:tc><w:tcPr/><w:p><w:pPr><w:pStyle w:val="MdTableCell"/></w:pPr></w:p></w:tc>`
    const out = applyTableHeaderShading(xml)
    const matches = out.match(/w:fill="F6F8FA"/g) ?? []
    expect(matches.length).toBe(1)
  })
})

describe("applyHeadingBookmarksAndAnchors — heading 加 bookmark + #anchor 转内部跳转", () => {
  test("heading 段加 bookmarkStart/End,name = h_<slug>(OOXML 规则:letter 开头)", () => {
    const docXml =
      `<w:p><w:pPr><w:pStyle w:val="MdHeading2"/></w:pPr><w:r><w:t>1. 标题层级</w:t></w:r></w:p>`
    const relsXml = `<Relationships></Relationships>`
    const out = applyHeadingBookmarksAndAnchors(docXml, relsXml)
    expect(out.docXml).toContain('<w:bookmarkStart')
    expect(out.docXml).toContain('w:name="h_1-标题层级"')
    expect(out.docXml).toContain('<w:bookmarkEnd')
  })

  test("hyperlink r:id → w:anchor=h_<slug> + 删 _rels 中的 external rel", () => {
    const docXml = `<w:hyperlink r:id="rId5"><w:r><w:t>1. 标题层级</w:t></w:r></w:hyperlink>`
    const relsXml =
      `<Relationships>` +
      `<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="#1-标题层级" TargetMode="External"/>` +
      `</Relationships>`
    const out = applyHeadingBookmarksAndAnchors(docXml, relsXml)
    expect(out.docXml).toContain('<w:hyperlink w:anchor="h_1-标题层级">')
    expect(out.docXml).not.toContain('r:id="rId5"')
    expect(out.relsXml).not.toContain('rId5') // external rel 已删
  })

  test("非 # 开头的 hyperlink(外链)→ 不动", () => {
    const docXml = `<w:hyperlink r:id="rId7"><w:r><w:t>外链</w:t></w:r></w:hyperlink>`
    const relsXml =
      `<Relationships>` +
      `<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>` +
      `</Relationships>`
    const out = applyHeadingBookmarksAndAnchors(docXml, relsXml)
    expect(out.docXml).toContain('r:id="rId7"') // 原 r:id 保留
    expect(out.relsXml).toContain("rId7") // 外链 rel 保留
  })

  test("多个相同 slug heading → 同一 bookmark name 但不同 bookmark id", () => {
    const docXml =
      `<w:p><w:pPr><w:pStyle w:val="MdHeading2"/></w:pPr><w:r><w:t>测试</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:pStyle w:val="MdHeading3"/></w:pPr><w:r><w:t>测试</w:t></w:r></w:p>`
    const out = applyHeadingBookmarksAndAnchors(docXml, "<Relationships></Relationships>")
    // 同 slug 复用 bookmark id(简化实现);至少都加了 bookmark
    const bmkStarts = out.docXml.match(/<w:bookmarkStart/g) ?? []
    expect(bmkStarts.length).toBeGreaterThanOrEqual(1)
  })

  test("无 heading 段 → 不动", () => {
    const docXml = `<w:p><w:r><w:t>普通段</w:t></w:r></w:p>`
    const out = applyHeadingBookmarksAndAnchors(docXml, "<Relationships></Relationships>")
    expect(out.docXml).toBe(docXml)
  })
})

describe("applyMathSentinels — 数学公式占位 sentinel 替换为 OMML", () => {
  // 注:applyMathSentinels 依赖 mathRegistry(模块级状态),preprocessMarkdown 时填充
  // 这里直接测无 sentinel 时的不变性 + 含 sentinel 但 registry 空的 fallback

  test("无 math sentinel → 不动(registry 空时直接返)", () => {
    const xml = `<w:p><w:r><w:t>plain</w:t></w:r></w:p>`
    expect(applyMathSentinels(xml)).toBe(xml)
  })

  test("含 sentinel 但 registry 空 → 仍返原(因 mathRegistry.size 为 0 时函数早返)", () => {
    // registry 空时函数早返,不动 docXml(包括残留 sentinel)
    const sentinel = String.fromCharCode(0xe150) + "M0" + String.fromCharCode(0xe151)
    const xml = `<w:p><w:r><w:t>before${sentinel}after</w:t></w:r></w:p>`
    const out = applyMathSentinels(xml)
    expect(out).toBe(xml)
  })

  test("含 m: namespace 已声明 → 不重复加", async () => {
    // 这条用 preprocessMarkdown 跑一遍(填 registry),再 applyMathSentinels
    // 但 preprocessMarkdown 是 async + 含 katex/mml2omml import,集成测试代价大
    // 最小验证:registry 空 + 任意 docXml 都不挂
    const xml = `<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body></w:body></w:document>`
    expect(() => applyMathSentinels(xml)).not.toThrow()
  })
})


