// build-keyvisuals.ts
//
// 広告用キービジュアル SVG と Figma 流し込み用 atom library を書き出す:
//   - public/keyvisual/square.svg        (1200x1200, SNS feed 1:1)
//   - public/keyvisual/wide.svg          (1920x1080, Display 16:9)
//   - public/keyvisual/library.svg       (1600x2200, Figma 用ステッカーシート)
//   - public/keyvisual/atoms/*.svg       (wordmark / palette / terminal / tee /
//                                         value-pill / stamp / footer 個別)
//
// SVG は Figma にドラッグ&ドロップで読み込めるベクター素材として設計している。
//   - text 要素は Figma が持つ Inter / Noto Sans JP を使う (font 自動マッピング)
//   - filter / mask の類は最小限 (Figma の SVG import は filter を時々落とすため)
//   - 各 atom は <g data-name="..."> でラベル付け → Figma 上でレイヤー名になる
//   - 配色は demo/app/globals.css の --color-sc-* と一致させる
//   - wordmark は demo/components/Wordmark.tsx と同じ 5x7 ピクセル定義を使う
//
// 実行: bun demo/scripts/build-keyvisuals.ts

import { mkdir, writeFile } from "node:fs/promises"
import { join, dirname } from "node:path"

// ---- shared palette -------------------------------------------------------

const PAL = {
  bg: "#131010",
  bgSoft: "#1b1818",
  border: "#3e3939",
  borderStrong: "#4b4646",
  textDim: "#716c6b",
  textMid: "#b7b1b1",
  text: "#f1ecec",
  ember: "#fc533a",
  emberSoft: "#ff8a73",
  cobalt: "#034cff",
  cobaltSoft: "#89b5ff",
  mint: "#c8ffc4",
  cream: "#f7f5ef",
  shadow: "#08192e",
} as const

// ---- 5x7 pixel wordmark glyphs (Wordmark.tsx と同じ定義) ----------------

const GLYPHS: Record<string, string[]> = {
  S: [".XXXX", "X....", "X....", ".XXX.", "....X", "....X", "XXXX."],
  E: ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"],
  C: [".XXXX", "X....", "X....", "X....", "X....", "X....", ".XXXX"],
  U: ["X...X", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  R: ["XXXX.", "X...X", "X...X", "XXXX.", "X.X..", "X..X.", "X...X"],
  O: [".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  D: ["XXXX.", "X...X", "X...X", "X...X", "X...X", "X...X", "XXXX."],
  " ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
}
const CHAR_W = 5
const CHAR_H = 7
const CHAR_GAP = 1

function wordmarkWidth(text: string, scale: number) {
  const n = text.length
  return (n * CHAR_W + Math.max(0, n - 1) * CHAR_GAP) * scale
}

function wordmark(text: string, x: number, y: number, scale: number) {
  // 明色ブロックと、右下に 1px ずらした影ブロックの 2 層
  const offset = scale
  const lit: Array<{ x: number; y: number }> = []
  let cursor = 0
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "]
    for (let row = 0; row < CHAR_H; row++) {
      for (let col = 0; col < CHAR_W; col++) {
        if (glyph[row][col] === "X") {
          lit.push({ x: x + (cursor + col) * scale, y: y + row * scale })
        }
      }
    }
    cursor += CHAR_W + CHAR_GAP
  }
  const shadow = lit
    .map((c) => rect(c.x + offset, c.y + offset, scale, scale, PAL.shadow))
    .join("")
  const main = lit.map((c) => rect(c.x, c.y, scale, scale, PAL.cream)).join("")
  return `<g data-label="wordmark"><g data-label="wordmark-shadow">${shadow}</g><g data-label="wordmark-main">${main}</g></g>`
}

// ---- low-level helpers ---------------------------------------------------

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  extra = "",
) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra ? " " + extra : ""}/>`

function gridLines(w: number, h: number, step: number, alpha: number) {
  const out: string[] = []
  for (let y = step; y < h; y += step) {
    out.push(
      `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#ffffff" stroke-opacity="${alpha}"/>`,
    )
  }
  for (let x = step; x < w; x += step) {
    out.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#ffffff" stroke-opacity="${alpha}"/>`,
    )
  }
  return out.join("")
}

function text(
  s: string,
  x: number,
  y: number,
  size: number,
  opts: {
    fill?: string
    weight?: number
    family?: "Inter" | "Noto Sans JP" | "JetBrains Mono"
    tracking?: number
    anchor?: "start" | "middle" | "end"
    upper?: boolean
  } = {},
) {
  const family =
    opts.family ??
    (/[぀-ヿ㐀-鿿]/.test(s) ? "Noto Sans JP" : "Inter")
  const t = opts.upper ? s.toUpperCase() : s
  return `<text x="${x}" y="${y}" font-family="${family}, sans-serif" font-size="${size}" font-weight="${
    opts.weight ?? 500
  }" fill="${opts.fill ?? PAL.text}" text-anchor="${opts.anchor ?? "start"}"${
    opts.tracking ? ` letter-spacing="${opts.tracking}"` : ""
  }>${escapeXml(t)}</text>`
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// ---- background ----------------------------------------------------------

function background(w: number, h: number, gridStep: number) {
  return `
    <rect width="${w}" height="${h}" fill="${PAL.bg}"/>
    <g data-label="grid">${gridLines(w, h, gridStep, 0.035)}</g>
    <g data-label="ambient">
      <radialGradient id="glow-ember" cx="0.5" cy="0.45" r="0.5">
        <stop offset="0%" stop-color="${PAL.ember}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${PAL.ember}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glow-cobalt" cx="0.85" cy="0.85" r="0.55">
        <stop offset="0%" stop-color="${PAL.cobalt}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${PAL.cobalt}" stop-opacity="0"/>
      </radialGradient>
      <rect width="${w}" height="${h}" fill="url(#glow-ember)"/>
      <rect width="${w}" height="${h}" fill="url(#glow-cobalt)"/>
    </g>
  `
}

// ---- TEE flow diagram (再利用パーツ) -------------------------------------

function teeDiagram(cx: number, cy: number, scale: number) {
  // viewBox 600x180 を scale 倍して中央 (cx, cy) に配置
  const W = 600 * scale
  const H = 180 * scale
  const x0 = cx - W / 2
  const y0 = cy - H / 2

  const s = (v: number) => v * scale

  // node 座標 (viewBox 600x180 内)
  const dev = { x: 0, y: 60, w: 120, h: 60 }
  const tee = { x: 220, y: 0, w: 240, h: 180 }
  const llm = { x: 250, y: 70, w: 180, h: 70 }
  const res = { x: 540, y: 60, w: 60, h: 60 }

  const node = (
    n: { x: number; y: number; w: number; h: number },
    fill: string,
    stroke: string,
  ) =>
    `<rect x="${x0 + s(n.x)}" y="${y0 + s(n.y)}" width="${s(n.w)}" height="${s(
      n.h,
    )}" rx="${s(6)}" fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(
      1,
      Math.round(s(1.4)),
    )}"/>`

  const teeStrokeW = Math.max(2, Math.round(s(2)))
  const arrow = (x1: number, x2: number, y: number) => `
    <line x1="${x0 + s(x1)}" y1="${y0 + s(y)}" x2="${x0 + s(x2)}" y2="${y0 + s(y)}" stroke="url(#flow)" stroke-width="${Math.max(2, Math.round(s(2)))}" stroke-dasharray="${s(8)} ${s(6)}"/>
    <polygon points="${x0 + s(x2)},${y0 + s(y)} ${x0 + s(x2 - 6)},${y0 + s(y - 4)} ${x0 + s(x2 - 6)},${y0 + s(y + 4)}" fill="${PAL.cobalt}"/>
  `

  return `
    <defs>
      <linearGradient id="flow" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${PAL.ember}"/>
        <stop offset="100%" stop-color="${PAL.cobalt}"/>
      </linearGradient>
      <linearGradient id="tee-edge" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${PAL.ember}" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="${PAL.cobalt}" stop-opacity="0.85"/>
      </linearGradient>
    </defs>

    <g data-label="tee-flow">
      ${node(dev, PAL.bgSoft, PAL.border)}
      ${text("DEVELOPER", x0 + s(dev.x + dev.w / 2), y0 + s(dev.y + 26), s(11), { fill: PAL.textMid, family: "JetBrains Mono", anchor: "middle", upper: true, tracking: 1.2 })}
      ${text("$ securecode", x0 + s(dev.x + dev.w / 2), y0 + s(dev.y + 44), s(10), { fill: PAL.textDim, family: "JetBrains Mono", anchor: "middle" })}

      ${arrow(dev.x + dev.w, tee.x, 90)}
      ${text("ENCRYPTED", x0 + s((dev.x + dev.w + tee.x) / 2), y0 + s(82), s(10), { fill: PAL.ember, family: "JetBrains Mono", anchor: "middle", upper: true, tracking: 1.5 })}

      <rect x="${x0 + s(tee.x)}" y="${y0 + s(tee.y)}" width="${s(tee.w)}" height="${s(tee.h)}" rx="${s(8)}" fill="${PAL.bgSoft}" stroke="url(#tee-edge)" stroke-width="${teeStrokeW}"/>
      ${text("CONFIDENTIAL VM (TEE)", x0 + s(tee.x + tee.w / 2), y0 + s(28), s(12), { fill: PAL.textMid, family: "JetBrains Mono", anchor: "middle", upper: true, tracking: 1.5 })}
      ${text("AMD SEV-SNP  ·  NVIDIA CC", x0 + s(tee.x + tee.w / 2), y0 + s(46), s(11), { fill: PAL.textDim, family: "JetBrains Mono", anchor: "middle" })}

      ${node(llm, "#252121", PAL.borderStrong)}
      ${text("Qwen3.6", x0 + s(llm.x + llm.w / 2), y0 + s(llm.y + 28), s(13), { fill: PAL.text, family: "JetBrains Mono", anchor: "middle" })}
      ${text("decrypt → infer → encrypt", x0 + s(llm.x + llm.w / 2), y0 + s(llm.y + 50), s(10), { fill: PAL.textDim, family: "JetBrains Mono", anchor: "middle" })}

      ${arrow(tee.x + tee.w, res.x, 90)}
      ${node(res, PAL.bgSoft, PAL.border)}
      ${text("OK", x0 + s(res.x + res.w / 2), y0 + s(res.y + 36), s(14), { fill: PAL.mint, family: "JetBrains Mono", anchor: "middle", weight: 700 })}
    </g>
  `
}

// ---- square (1200 x 1200) -----------------------------------------------
//
// SNS feed 想定なので TEE 図のような細部は省き、wordmark + tagline + 3 値訴求の
// 純メッセージ広告として組む。

function buildSquare(): string {
  const W = 1200
  const H = 1200

  // wordmark スケールを大きめに → punchy に
  const wmScale = 16
  const wmW = wordmarkWidth("SECURE CODE", wmScale)
  const wmX = Math.round((W - wmW) / 2)
  const wmY = 380

  const stampY = 240
  const taglineY = 720
  const subY = 790
  const valueRowY = 940
  const footY = 1140

  // 3 値訴求のピル位置 (中央寄せの 3 列)
  const colW = 320
  const colGap = 40
  const totalRowW = colW * 3 + colGap * 2
  const rowX0 = (W - totalRowW) / 2
  const valueCols = [
    {
      tag: "01",
      title: "TEE 保護",
      body: "誰にも見せず推論",
    },
    {
      tag: "02",
      title: "HARNESS",
      body: "AI を組織ポリシー下に",
    },
    {
      tag: "03",
      title: "AI 開発加速",
      body: "ターミナルで完結",
    },
  ]

  const valueCards = valueCols
    .map((v, i) => {
      const x = rowX0 + i * (colW + colGap)
      return `
      <g data-label="value-${v.tag}">
        <line x1="${x}" y1="${valueRowY}" x2="${x + 60}" y2="${valueRowY}" stroke="${PAL.ember}" stroke-width="2"/>
        ${text(v.tag, x, valueRowY + 38, 18, { fill: PAL.ember, family: "JetBrains Mono", tracking: 2 })}
        ${text(v.title, x, valueRowY + 86, 38, { fill: PAL.text, family: "Noto Sans JP", weight: 700 })}
        ${text(v.body, x, valueRowY + 124, 20, { fill: PAL.textMid, family: "Noto Sans JP" })}
      </g>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-name="secure-code-key-visual-square">
  ${background(W, H, 60)}

  <g data-label="stamp">
    <line x1="${W / 2 - 220}" y1="${stampY}" x2="${W / 2 - 80}" y2="${stampY}" stroke="${PAL.ember}" stroke-width="1.5"/>
    ${text("CONFIDENTIAL AI SUITE  /  第 2 弾製品", W / 2, stampY + 6, 22, { fill: PAL.textMid, family: "JetBrains Mono", anchor: "middle", tracking: 3.6, upper: true })}
    <line x1="${W / 2 + 80}" y1="${stampY}" x2="${W / 2 + 220}" y2="${stampY}" stroke="${PAL.ember}" stroke-width="1.5"/>
  </g>

  ${wordmark("SECURE CODE", wmX, wmY, wmScale)}

  ${text("機密コードを、誰にも見せないまま AI へ。", W / 2, taglineY, 50, { fill: PAL.text, family: "Noto Sans JP", weight: 700, anchor: "middle" })}
  ${text("Trusted Execution Environment による Confidential AI Coding.", W / 2, subY, 22, { fill: PAL.textMid, family: "Inter", anchor: "middle", tracking: 1.2 })}

  ${valueCards}

  <g data-label="footer">
    <line x1="120" y1="${footY - 40}" x2="${W - 120}" y2="${footY - 40}" stroke="${PAL.border}" stroke-width="1"/>
    <circle cx="120" cy="${footY}" r="4" fill="${PAL.ember}"/>
    ${text("ACOMPANY  SECURE  CODE", 138, footY + 6, 18, { fill: PAL.textMid, family: "JetBrains Mono", tracking: 2.4 })}
    ${text("acompany.tech / securecode", W - 120, footY + 6, 18, { fill: PAL.textDim, family: "JetBrains Mono", anchor: "end" })}
  </g>
</svg>
`
}

// ---- wide (1920 x 1080) --------------------------------------------------

function buildWide(): string {
  const W = 1920
  const H = 1080

  // 左ペインに wordmark、右ペインに大きな TEE 図
  const padX = 140
  const wmScale = 14
  const wmW = wordmarkWidth("SECURE CODE", wmScale)
  const wmX = padX
  const wmY = 380

  const stampY = 250
  const taglineY = 590
  const subY = 670
  const ctaY = 820
  const footY = 1000

  // 右ペインの図の中心 — 全体を 1.3 倍してパネルを埋めつつ右端に余白を残す
  const diagCx = W - 540
  const diagCy = H / 2 - 20

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-name="secure-code-key-visual-wide">
  ${background(W, H, 60)}

  <g data-label="left-pane">
    <g data-label="stamp">
      <line x1="${padX}" y1="${stampY}" x2="${padX + 60}" y2="${stampY}" stroke="${PAL.ember}" stroke-width="1.5"/>
      ${text("CONFIDENTIAL AI SUITE  /  第 2 弾製品", padX + 76, stampY + 6, 22, { fill: PAL.textMid, family: "JetBrains Mono", tracking: 3.2, upper: true })}
    </g>

    ${wordmark("SECURE CODE", wmX, wmY, wmScale)}

    ${text("機密コードを、", padX, taglineY, 60, { fill: PAL.text, family: "Noto Sans JP", weight: 700 })}
    ${text("誰にも見せないまま AI へ。", padX, taglineY + 76, 60, { fill: PAL.text, family: "Noto Sans JP", weight: 700 })}
    ${text("Trusted Execution Environment による機密保護 × 自律的なハーネス制御 ×", padX, subY + 80, 22, { fill: PAL.textMid, family: "Inter", tracking: 0.6 })}
    ${text("ターミナルで完結する AI コーディング。", padX, subY + 110, 22, { fill: PAL.textMid, family: "Inter", tracking: 0.6 })}

    <g data-label="cta">
      <rect x="${padX}" y="${ctaY}" width="220" height="56" rx="6" fill="none" stroke="${PAL.ember}" stroke-width="2"/>
      ${text("$  ベータ版を試す  →", padX + 110, ctaY + 36, 20, { fill: PAL.text, family: "JetBrains Mono", anchor: "middle" })}
    </g>
  </g>

  ${teeDiagram(diagCx, diagCy, 1.3)}

  <g data-label="diagram-caption">
    ${text("CONFIDENTIAL AI INFERENCE  /  attested by AMD SEV-SNP × NVIDIA CC", diagCx, diagCy + 220, 18, { fill: PAL.textDim, family: "JetBrains Mono", anchor: "middle", tracking: 1.6 })}
  </g>

  <g data-label="footer">
    <line x1="${padX}" y1="${footY - 26}" x2="${W - padX}" y2="${footY - 26}" stroke="${PAL.border}" stroke-width="1"/>
    <circle cx="${padX}" cy="${footY}" r="4" fill="${PAL.ember}"/>
    ${text("ACOMPANY  SECURE  CODE", padX + 18, footY + 6, 18, { fill: PAL.textMid, family: "JetBrains Mono", tracking: 2.4 })}
    ${text("acompany.tech / securecode", W - padX, footY + 6, 18, { fill: PAL.textDim, family: "JetBrains Mono", anchor: "end" })}
  </g>
</svg>
`
}

// ---- atoms (standalone SVG ファイル) ------------------------------------
//
// Figma に 1 つずつドラッグして「Component」として保存できる粒度のパーツ。
// 各 atom は独立した <svg> ドキュメント。Library 内では同じ関数の中身
// (g 要素ぶん) を再利用するため、本体を returnGroup() で取り出し、ラッパー
// (svg + 背景) を atom*() で巻き直している。

function svgDoc(
  w: number,
  h: number,
  name: string,
  bg: string | null,
  body: string,
): string {
  const bgRect = bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ""
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" data-name="${name}">
  ${bgRect}
  ${body}
</svg>
`
}

function atomWordmark(): string {
  const scale = 18
  const padding = 40
  const wmW = wordmarkWidth("SECURE CODE", scale)
  const W = wmW + scale + padding * 2
  const H = CHAR_H * scale + scale + padding * 2
  return svgDoc(W, H, "atom-wordmark", PAL.bg, wordmark("SECURE CODE", padding, padding, scale))
}

function atomPalette(): string {
  // 12 色を 4x3 で並べる
  const cellW = 240
  const cellH = 140
  const cols = 4
  const colors = Object.entries(PAL) as Array<[string, string]>
  const rows = Math.ceil(colors.length / cols)
  const padding = 40
  const W = cellW * cols + padding * 2
  const H = cellH * rows + padding * 2

  const cells = colors
    .map(([name, hex], i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = padding + col * cellW
      const y = padding + row * cellH
      const isLight = ["text", "textMid", "cream", "mint", "emberSoft", "cobaltSoft"].includes(name)
      const labelFill = isLight ? PAL.shadow : PAL.text
      return `
        <g data-name="swatch-${name}">
          <rect x="${x}" y="${y}" width="${cellW - 12}" height="${cellH - 12}" fill="${hex}"/>
          ${text(`--color-sc-${name}`, x + 14, y + 30, 14, { fill: labelFill, family: "JetBrains Mono", weight: 500 })}
          ${text(hex.toUpperCase(), x + 14, y + cellH - 30, 18, { fill: labelFill, family: "JetBrains Mono", weight: 700 })}
        </g>
      `
    })
    .join("")

  return svgDoc(W, H, "atom-palette", PAL.bg, cells)
}

function terminalFrame(x: number, y: number, w: number, h: number): string {
  const titlebarH = 36
  const footerH = 30
  return `
    <g data-name="terminal-frame">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${PAL.bgSoft}" stroke="${PAL.border}"/>
      <rect x="${x}" y="${y}" width="${w}" height="${titlebarH}" rx="10" fill="${PAL.bgSoft}" stroke="${PAL.border}"/>
      <rect x="${x}" y="${y + titlebarH - 10}" width="${w}" height="10" fill="${PAL.bgSoft}" stroke="${PAL.border}"/>
      <line x1="${x}" y1="${y + titlebarH}" x2="${x + w}" y2="${y + titlebarH}" stroke="${PAL.border}"/>
      <circle cx="${x + 18}" cy="${y + titlebarH / 2}" r="6" fill="#ff5f56"/>
      <circle cx="${x + 36}" cy="${y + titlebarH / 2}" r="6" fill="#ffbd2e"/>
      <circle cx="${x + 54}" cy="${y + titlebarH / 2}" r="6" fill="#27c93f"/>
      ${text("securecode", x + w / 2, y + titlebarH / 2 + 4, 12, { fill: PAL.textMid, family: "JetBrains Mono", anchor: "middle" })}
      ${text("Code review", x + w - 16, y + titlebarH / 2 + 4, 11, { fill: PAL.textDim, family: "JetBrains Mono", anchor: "end" })}

      <!-- sample prompt -->
      <rect x="${x + 60}" y="${y + h / 2 - 30}" width="${w - 120}" height="60" rx="6" fill="${PAL.bgSoft}" stroke="${PAL.border}"/>
      ${text("$  Ask anything...", x + 80, y + h / 2 + 8, 16, { fill: PAL.text, family: "JetBrains Mono" })}
      ${text("▌", x + 80 + 180, y + h / 2 + 8, 16, { fill: PAL.ember, family: "JetBrains Mono" })}

      <!-- footer status bar -->
      <line x1="${x}" y1="${y + h - footerH}" x2="${x + w}" y2="${y + h - footerH}" stroke="${PAL.border}"/>
      ${text("/private/tmp/demo", x + 16, y + h - 10, 11, { fill: PAL.textDim, family: "JetBrains Mono" })}
      ${text("◯ 3 MCP  /status", x + w - 140, y + h - 10, 11, { fill: PAL.textDim, family: "JetBrains Mono" })}
      ${text("Acompany", x + w - 16, y + h - 10, 11, { fill: PAL.ember, family: "JetBrains Mono", anchor: "end" })}
    </g>
  `
}

function atomTerminal(): string {
  const padding = 40
  const w = 1120
  const h = 580
  return svgDoc(w + padding * 2, h + padding * 2, "atom-terminal", PAL.bg, terminalFrame(padding, padding, w, h))
}

function atomTeeDiagram(): string {
  const W = 900
  const H = 320
  return svgDoc(W, H, "atom-tee-diagram", PAL.bg, teeDiagram(W / 2, H / 2, 1.2))
}

function valuePill(x: number, y: number, tag: string, title: string, body: string): string {
  return `
    <g data-name="value-pill-${tag}">
      <line x1="${x}" y1="${y}" x2="${x + 60}" y2="${y}" stroke="${PAL.ember}" stroke-width="2"/>
      ${text(tag, x, y + 38, 18, { fill: PAL.ember, family: "JetBrains Mono", tracking: 2 })}
      ${text(title, x, y + 86, 38, { fill: PAL.text, family: "Noto Sans JP", weight: 700 })}
      ${text(body, x, y + 124, 20, { fill: PAL.textMid, family: "Noto Sans JP" })}
    </g>
  `
}

function atomValuePills(): string {
  const padding = 40
  const colW = 340
  const colGap = 40
  const W = colW * 3 + colGap * 2 + padding * 2
  const H = 200
  const cards = [
    valuePill(padding + 0 * (colW + colGap), padding + 30, "01", "TEE 保護", "誰にも見せず推論"),
    valuePill(padding + 1 * (colW + colGap), padding + 30, "02", "HARNESS", "AI を組織ポリシー下に"),
    valuePill(padding + 2 * (colW + colGap), padding + 30, "03", "AI 開発加速", "ターミナルで完結"),
  ].join("")
  return svgDoc(W, H, "atom-value-pills", PAL.bg, cards)
}

function brandStampGroup(x: number, y: number, withRule = true): string {
  const ruleLeft = withRule
    ? `<line x1="${x}" y1="${y}" x2="${x + 60}" y2="${y}" stroke="${PAL.ember}" stroke-width="1.5"/>`
    : ""
  return `
    <g data-name="brand-stamp">
      ${ruleLeft}
      ${text("CONFIDENTIAL AI SUITE  /  第 2 弾製品", x + (withRule ? 76 : 0), y + 6, 22, { fill: PAL.textMid, family: "JetBrains Mono", tracking: 3.2, upper: true })}
    </g>
  `
}

function atomStamp(): string {
  const W = 900
  const H = 120
  return svgDoc(W, H, "atom-stamp", PAL.bg, brandStampGroup(40, H / 2))
}

function footerLineGroup(x0: number, y: number, w: number): string {
  return `
    <g data-name="brand-footer">
      <line x1="${x0}" y1="${y - 40}" x2="${x0 + w}" y2="${y - 40}" stroke="${PAL.border}" stroke-width="1"/>
      <circle cx="${x0}" cy="${y}" r="4" fill="${PAL.ember}"/>
      ${text("ACOMPANY  SECURE  CODE", x0 + 18, y + 6, 18, { fill: PAL.textMid, family: "JetBrains Mono", tracking: 2.4 })}
      ${text("acompany.tech / securecode", x0 + w, y + 6, 18, { fill: PAL.textDim, family: "JetBrains Mono", anchor: "end" })}
    </g>
  `
}

function atomFooter(): string {
  const W = 1200
  const H = 140
  return svgDoc(W, H, "atom-footer", PAL.bg, footerLineGroup(40, H - 40, W - 80))
}

// ---- library (1 枚物のステッカーシート) ----------------------------------

function buildLibrary(): string {
  const W = 1600
  const H = 2620
  const padX = 80

  const sectionTitle = (label: string, y: number) =>
    `<g data-name="section-title">
      <line x1="${padX}" y1="${y}" x2="${padX + 40}" y2="${y}" stroke="${PAL.ember}" stroke-width="2"/>
      ${text(label, padX + 60, y + 8, 20, { fill: PAL.textMid, family: "JetBrains Mono", tracking: 3, upper: true })}
    </g>`

  // ── wordmark section
  const wmScale = 16
  const wmW = wordmarkWidth("SECURE CODE", wmScale)
  const wm = wordmark("SECURE CODE", (W - wmW) / 2, 220, wmScale)
  // 下段: 2 サイズを左右に並べる (重なり回避)
  const wmSmallScale = 6
  const wmMedScale = 10
  const wmSmallW = wordmarkWidth("SECURE CODE", wmSmallScale) + wmSmallScale
  const wmMedW = wordmarkWidth("SECURE CODE", wmMedScale) + wmMedScale
  const wmSmall = wordmark("SECURE CODE", padX, 400, wmSmallScale)
  const wmMed = wordmark(
    "SECURE CODE",
    padX + wmSmallW + 80,
    400,
    wmMedScale,
  )

  // ── palette section (14 色を 7x2 で配置)
  const paletteY = 580
  const swatchSize = 180
  const swatchGap = 24
  const swatchCols = 7
  const allColors = Object.entries(PAL)
  const paletteCells = allColors
    .map(([name, hex], i) => {
      const col = i % swatchCols
      const row = Math.floor(i / swatchCols)
      const x = padX + col * (swatchSize + swatchGap)
      const y = paletteY + 60 + row * (swatchSize + 60)
      return `
        <g data-name="swatch-${name}">
          <rect x="${x}" y="${y}" width="${swatchSize}" height="${swatchSize}" fill="${hex}" stroke="${PAL.border}"/>
          ${text(name, x, y + swatchSize + 26, 14, { fill: PAL.textMid, family: "JetBrains Mono" })}
          ${text(hex.toUpperCase(), x, y + swatchSize + 46, 13, { fill: PAL.textDim, family: "JetBrains Mono" })}
        </g>
      `
    })
    .join("")

  // ── terminal frame section
  const termY = 1140
  const termW = 1440
  const termH = 460
  const term = terminalFrame(padX, termY + 60, termW, termH)

  // ── TEE diagram section
  const teeY = 1720
  const teeBlock = teeDiagram(W / 2, teeY + 200, 1.4)

  // ── value pills
  const pillY = 2080
  const pillColW = 380
  const pillGap = 60
  const pillRowW = pillColW * 3 + pillGap * 2
  const pillX0 = (W - pillRowW) / 2
  const pills = [
    valuePill(pillX0 + 0 * (pillColW + pillGap), pillY + 70, "01", "TEE 保護", "誰にも見せず推論"),
    valuePill(pillX0 + 1 * (pillColW + pillGap), pillY + 70, "02", "HARNESS", "AI を組織ポリシー下に"),
    valuePill(pillX0 + 2 * (pillColW + pillGap), pillY + 70, "03", "AI 開発加速", "ターミナルで完結"),
  ].join("")

  // ── stamp + footer
  const brandSectionY = 2360
  const brandStampY = brandSectionY + 50
  const brandFooterY = brandSectionY + 160
  const stamp = brandStampGroup(padX, brandStampY)
  const footer = footerLineGroup(padX, brandFooterY, W - padX * 2)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-name="secure-code-figma-library">
  ${background(W, H, 60)}

  <g data-name="header">
    ${text("ACOMPANY SECURE CODE", padX, 90, 22, { fill: PAL.textMid, family: "JetBrains Mono", tracking: 3.2, upper: true })}
    ${text("BRAND ATOMS FOR FIGMA  ·  ドラッグ&ドロップで取り込み、Component 化して再利用", padX, 130, 18, { fill: PAL.textDim, family: "Inter" })}
    <line x1="${padX}" y1="160" x2="${W - padX}" y2="160" stroke="${PAL.border}"/>
  </g>

  ${sectionTitle("01  Wordmark", 200)}
  ${wm}
  ${wmSmall}
  ${wmMed}

  ${sectionTitle("02  Palette  (matches --color-sc-* in globals.css)", paletteY)}
  ${paletteCells}

  ${sectionTitle("03  Terminal Frame", termY)}
  ${term}

  ${sectionTitle("04  TEE Diagram", teeY)}
  ${teeBlock}

  ${sectionTitle("05  Value Pills", pillY)}
  ${pills}

  ${sectionTitle("06  Stamp & Footer", brandSectionY)}
  ${stamp}
  ${footer}
</svg>
`
}

// ---- main ----------------------------------------------------------------

async function main() {
  const outDir = join(import.meta.dirname!, "..", "public", "keyvisual")
  const atomsDir = join(outDir, "atoms")
  await mkdir(outDir, { recursive: true })
  await mkdir(atomsDir, { recursive: true })

  const targets: Array<{ path: string; svg: string }> = [
    { path: join(outDir, "square.svg"), svg: buildSquare() },
    { path: join(outDir, "wide.svg"), svg: buildWide() },
    { path: join(outDir, "library.svg"), svg: buildLibrary() },
    { path: join(atomsDir, "wordmark.svg"), svg: atomWordmark() },
    { path: join(atomsDir, "palette.svg"), svg: atomPalette() },
    { path: join(atomsDir, "terminal.svg"), svg: atomTerminal() },
    { path: join(atomsDir, "tee-diagram.svg"), svg: atomTeeDiagram() },
    { path: join(atomsDir, "value-pills.svg"), svg: atomValuePills() },
    { path: join(atomsDir, "stamp.svg"), svg: atomStamp() },
    { path: join(atomsDir, "footer.svg"), svg: atomFooter() },
  ]

  for (const t of targets) {
    await writeFile(t.path, t.svg, "utf8")
    const bytes = Buffer.byteLength(t.svg, "utf8")
    console.log(`wrote ${t.path}  (${bytes.toLocaleString()} bytes)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
