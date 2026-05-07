// FORK: md-export-docx 关键纯函数测试 — 2026-05-07
// 关键模块清单内的文件(R5 决策 2),目标 80% 覆盖率。
// 已覆盖:mimeFromPath / friendlyError / base64ToBytes / bytesToBase64 /
//          splitRunsForEmoji / mergeCodeBlockParagraphs
// 待覆盖:patchForeignObjects(SVG DOM,需 happydom)/ inlineLocalImages(异步 + Tauri invoke,需 mock)/
//          exportMdAsDocx(集成,后期 e2e 路线覆盖)

import { describe, expect, test } from "bun:test"
import {
  mimeFromPath,
  friendlyError,
  base64ToBytes,
  bytesToBase64,
  splitRunsForEmoji,
  mergeCodeBlockParagraphs,
  patchForeignObjects,
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

