import { writeClipboardImage } from "./clipboard-image"

export interface ImageCardOptions {
  element: HTMLElement
  /** 卡片页眉右侧的会话标题 */
  title?: string
  /** 对应的用户提问，展示在正文之前 */
  question?: string
  /** 页脚元信息：代理 · 模型 · 耗时等 */
  meta?: string
  /** 页脚右侧日期 */
  time?: number
}

const CARD_WIDTH = 760
const FRAME_PADDING = 36

type Style = Partial<Record<keyof CSSStyleDeclaration, string>>

function el(doc: Document, tag: string, style: Style, children: (Node | string)[] = []) {
  const node = doc.createElement(tag)
  Object.assign(node.style, style)
  node.append(...children)
  return node
}

function opaque(color: string) {
  return !!color && color !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(color)
}

/** 沿 DOM 树向上找到实际生效的不透明背景色。 */
function resolveBackground(element: HTMLElement) {
  const win = element.ownerDocument.defaultView ?? window
  for (let cur: HTMLElement | null = element; cur; cur = cur.parentElement) {
    const bg = win.getComputedStyle(cur).backgroundColor
    if (opaque(bg)) return bg
  }
  const body = win.getComputedStyle(element.ownerDocument.body).backgroundColor
  return opaque(body) ? body : "#18181b"
}

function isDarkColor(color: string) {
  const [r = 0, g = 0, b = 0] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number)
  return (r * 299 + g * 587 + b * 114) / 1000 < 128
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function familyName(value: string) {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase()
}

/**
 * html-to-image 只扫描样式表顶层的 @font-face，KaTeX 等放在 @layer 里的字体会被漏掉，
 * 公式在导出图里退回系统字体后字距错乱。这里递归收集卡片实际用到的字体并内联成 data URL。
 */
async function fontEmbedCSS(doc: Document, root: HTMLElement) {
  const win = doc.defaultView ?? window
  const used = new Set<string>()
  for (const node of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    for (const name of win.getComputedStyle(node).fontFamily.split(",")) used.add(familyName(name))
  }
  const rules: CSSFontFaceRule[] = []
  const walk = (list: CSSRuleList) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSFontFaceRule) rules.push(rule)
      else if (rule instanceof CSSImportRule) rule.styleSheet && walk(rule.styleSheet.cssRules)
      else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules)
    } catch {
      // 跨域样式表不可读，交给浏览器已有字体兜底。
    }
  }
  const faces = await Promise.all(
    rules
      .filter((rule) => used.has(familyName(rule.style.getPropertyValue("font-family"))))
      .map(async (rule) => {
        const src = rule.style.getPropertyValue("src")
        const match = /url\(["']?([^"')]+\.woff2[^"')]*)["']?\)/.exec(src) ?? /url\(["']?([^"')]+)["']?\)/.exec(src)
        if (!match) return ""
        const url = new URL(match[1], rule.parentStyleSheet?.href ?? doc.baseURI).href
        const data = await fetch(url)
          .then((response) => (response.ok ? response.blob() : undefined))
          .then((blob) => (blob ? blobToDataUrl(blob) : undefined))
          .catch(() => undefined)
        if (!data) return ""
        return rule.cssText.replace(/src:[^;]+;/, `src: url("${data}");`)
      }),
  )
  return faces.filter(Boolean).join("\n")
}

/** OpenCode 方块标志，颜色写死，避免克隆后丢失主题变量。 */
function mark(doc: Document, strong: string, weak: string) {
  const ns = "http://www.w3.org/2000/svg"
  const svg = doc.createElementNS(ns, "svg")
  svg.setAttribute("viewBox", "0 0 16 20")
  svg.setAttribute("width", "13")
  svg.setAttribute("height", "16")
  for (const [d, fill] of [
    ["M12 16H4V8H12V16Z", weak],
    ["M12 4H4V16H12V4ZM16 20H0V0H16V20Z", strong],
  ]) {
    const path = doc.createElementNS(ns, "path")
    path.setAttribute("d", d)
    path.setAttribute("fill", fill)
    svg.append(path)
  }
  return svg
}

/**
 * 把一条回复排成分享卡片并写入剪贴板：纯色外框 + 圆角卡片，
 * 卡片内依次是品牌页眉、用户提问、回复正文和元信息页脚，宽度固定保证导出尺寸一致。
 */
export async function copyAsImageCard(options: ImageCardOptions): Promise<boolean> {
  const { element } = options
  const doc = element.ownerDocument || document
  const win = doc.defaultView || window
  const comp = win.getComputedStyle(element)
  const root = win.getComputedStyle(doc.documentElement)
  const token = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback

  const surface = resolveBackground(element)
  const dark = isDarkColor(surface)
  const text = comp.color || (dark ? "#ededed" : "#171717")
  const strong = token("--text-strong", text)
  const weak = token("--text-weak", dark ? "#a3a3a3" : "#737373")
  const font = comp.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  const frameBg = dark ? "#0c0c0d" : "#ececee"
  const hairline = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"
  const tintBg = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"

  const header = el(
    doc,
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "16px",
      padding: "18px 28px",
      borderBottom: `1px solid ${hairline}`,
    },
    [
      el(doc, "div", { display: "flex", alignItems: "center", gap: "10px", flexShrink: "0" }, [
        mark(doc, strong, dark ? "#5a5a5a" : "#c4c4c4"),
        el(doc, "span", { fontSize: "14px", fontWeight: "650", letterSpacing: "-0.01em", color: strong }, ["Basalt"]),
      ]),
      el(
        doc,
        "span",
        {
          minWidth: "0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "12.5px",
          color: weak,
        },
        [options.title ?? ""],
      ),
    ],
  )

  const body = element.cloneNode(true) as HTMLElement
  Object.assign(body.style, { margin: "0", maxWidth: "100%", overflow: "visible" })
  // 导出图不能横向滚动，长代码行折行显示而不是被截断。
  for (const pre of body.querySelectorAll<HTMLElement>("pre")) {
    Object.assign(pre.style, { whiteSpace: "pre-wrap", overflowWrap: "anywhere", overflow: "visible" })
  }
  for (const node of body.querySelectorAll<HTMLElement>("table, [data-component='markdown-code']")) {
    node.style.overflow = "visible"
  }

  const content = el(doc, "div", { padding: "24px 28px 8px" }, [])
  const question = options.question?.trim()
  if (question) {
    content.append(
      el(
        doc,
        "div",
        {
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: "22px",
        },
        [
          el(
            doc,
            "div",
            {
              maxWidth: "82%",
              padding: "10px 14px",
              borderRadius: "14px",
              background: tintBg,
              border: `1px solid ${hairline}`,
              color: strong,
              fontSize: "14px",
              lineHeight: "1.6",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              display: "-webkit-box",
              webkitLineClamp: "4",
              webkitBoxOrient: "vertical",
              overflow: "hidden",
            },
            [question],
          ),
        ],
      ),
    )
  }
  content.append(body)

  const date = options.time
    ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(options.time)
    : ""
  const footer = el(
    doc,
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "16px",
      margin: "16px 28px 0",
      padding: "14px 0 18px",
      borderTop: `1px solid ${hairline}`,
      fontSize: "12px",
      color: weak,
      fontVariantNumeric: "tabular-nums",
    },
    [el(doc, "span", {}, [options.meta ?? ""]), el(doc, "span", { flexShrink: "0" }, [date])],
  )

  const card = el(
    doc,
    "div",
    {
      boxSizing: "border-box",
      width: `${CARD_WIDTH}px`,
      borderRadius: "16px",
      background: surface,
      color: text,
      fontFamily: font,
      border: `1px solid ${dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
      boxShadow: dark
        ? "0 1px 2px rgba(0,0,0,0.4), 0 16px 40px -12px rgba(0,0,0,0.6)"
        : "0 1px 2px rgba(0,0,0,0.05), 0 16px 40px -16px rgba(0,0,0,0.18)",
      overflow: "hidden",
    },
    [header, content, footer],
  )

  const frame = el(doc, "div", { boxSizing: "border-box", padding: `${FRAME_PADDING}px`, background: frameBg }, [card])
  // 继承原消息所在容器的类名，让 Markdown 与代码高亮样式在克隆体上继续生效。
  const container = el(doc, "div", {
    position: "fixed",
    left: "-100000px",
    top: "0",
    pointerEvents: "none",
    zIndex: "-9999",
  })
  if (element.parentElement) container.className = element.parentElement.className
  container.setAttribute("aria-hidden", "true")
  container.append(frame)
  doc.body.append(container)

  try {
    await doc.fonts.ready
    await Promise.all(Array.from(body.querySelectorAll("img"), (image) => image.decode().catch(() => undefined)))
    const { toBlob } = await import("html-to-image")
    const width = Math.ceil(frame.scrollWidth)
    const height = Math.ceil(frame.scrollHeight)
    const pixelRatio = Math.min(2, 16384 / height)
    const fonts = await fontEmbedCSS(doc, frame).catch(() => "")
    const render = (skipFonts: boolean) =>
      toBlob(frame, {
        width,
        height,
        pixelRatio,
        backgroundColor: frameBg,
        skipFonts,
        ...(fonts && !skipFonts ? { fontEmbedCSS: fonts } : {}),
      })
    const blob = await render(false).catch(() => render(true))
    if (!blob) return false
    return await writeClipboardImage(blob)
  } catch (err) {
    console.error("Failed to copy image:", err)
    return false
  } finally {
    container.remove()
  }
}
