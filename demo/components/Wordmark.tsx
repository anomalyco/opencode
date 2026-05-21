// Wordmark.tsx
//
// "SECURE CODE" をフォント非依存のピクセル SVG として描画する。
// 当初は packages/ui/src/components/logo.tsx の ASCII art を <pre> で出していたが、
// ブラウザ / OS / フォントフォールバックの組み合わせ次第で 「╗」「█」 の幅が
// 揃わず崩れるため、5x7 の固定ビットマップを <rect> で焼き付ける方式に変更した。
//
// 各ピクセルは「メインの明色ブロック」+「右下のシャドウブロック」の 2 枚で
// 描き、本体ロゴ (logo-dark.svg / TUI スプラッシュ) のチャンキーな立体感に
// 寄せている。

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
const CHAR_GAP = 1 // 文字間 1px

type WordmarkProps = {
  text?: string
  className?: string
  /** 1 ピクセルが SVG ユニット何個分か（ビュー側で width で再スケールするので主に比率） */
  scale?: number
  /** 同じ文言を 1 度に複数描画するときの a11y label。省略時は text を使う */
  ariaLabel?: string
}

export function Wordmark({
  text = "SECURE CODE",
  className = "",
  scale = 10,
  ariaLabel,
}: WordmarkProps) {
  const chars = text.toUpperCase().split("")

  // 全体サイズを算出
  const totalCellsW =
    chars.length * CHAR_W + Math.max(0, chars.length - 1) * CHAR_GAP
  const shadowOffset = 1 // ピクセル
  const viewW = totalCellsW * scale + shadowOffset * scale
  const viewH = CHAR_H * scale + shadowOffset * scale

  const cells: Array<{ x: number; y: number }> = []
  let cursor = 0
  for (const ch of chars) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "]
    for (let row = 0; row < CHAR_H; row++) {
      for (let col = 0; col < CHAR_W; col++) {
        if (glyph[row][col] === "X") {
          cells.push({ x: (cursor + col) * scale, y: row * scale })
        }
      }
    }
    cursor += CHAR_W + CHAR_GAP
  }

  return (
    <svg
      role="img"
      aria-label={ariaLabel ?? text}
      viewBox={`0 0 ${viewW} ${viewH}`}
      preserveAspectRatio="xMidYMid meet"
      className={`block h-auto w-full ${className}`}
    >
      {/* シャドウ層 */}
      <g fill="#08192E">
        {cells.map((c, i) => (
          <rect
            key={`s${i}`}
            x={c.x + shadowOffset * scale}
            y={c.y + shadowOffset * scale}
            width={scale}
            height={scale}
          />
        ))}
      </g>
      {/* 本体層 */}
      <g fill="#F7F5EF">
        {cells.map((c, i) => (
          <rect key={`m${i}`} x={c.x} y={c.y} width={scale} height={scale} />
        ))}
      </g>
    </svg>
  )
}
