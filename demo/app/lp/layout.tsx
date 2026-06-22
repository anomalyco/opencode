// /lp 専用レイアウト。
//
// ルートレイアウト (app/layout.tsx) と globals.css は既存サービスサイト
// 向けのダークテーマを全体に適用しているため、/lp 配下だけを新デザイン
// （白基調 / slate + 赤アクセント / IBM Plex Sans JP）に上書きする。固定の
// 白レイヤーで body 背景を覆い、オーバースクロール時もダークが覗かないように
// している。フォントはルートレイアウトの Google Fonts link で読み込み済み。

const FONT_STACK =
  '"IBM Plex Sans JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif'

export default function LpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="lp-scope relative min-h-screen bg-white text-slate-900 antialiased"
      style={{ fontFamily: FONT_STACK }}
    >
      <div aria-hidden className="fixed inset-0 -z-10 bg-white" />
      {children}
    </div>
  )
}
