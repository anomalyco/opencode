// /lp専用レイアウト。
//
// ルートレイアウト (app/layout.tsx) とglobals.cssは既存サービスサイト
// 向けのダークテーマ (terminal / scanline / neon glow) を全体に適用して
// いる。だが、このLPのターゲットはセキュリティに敏感な意思決定者で、
// ダークでハッカー然とした見た目はむしろ「怪しい・胡散臭い」と受け取られ
// 入力をためらわせる。そこで /lp配下だけを白基調のクリーンコーポレート
// に上書きする。固定の白レイヤーでbody背景 (ダーク + グリッド) を覆い、
// オーバースクロール時にもダークが覗かないようにしている。

export default function LpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-scope relative min-h-screen bg-white text-slate-900 antialiased">
      <div aria-hidden className="fixed inset-0 -z-10 bg-white" />
      {children}
    </div>
  )
}
