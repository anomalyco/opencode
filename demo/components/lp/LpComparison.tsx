// SecureCode.dc.html の 05/比較。ネイビーヘッダー＋SC列は accent-soft。

const HANKEN = '"Hanken Grotesk", sans-serif'

const ROWS = [
  { feature: "入力が社外に漏洩しない", generic: "規約・契約で担保", sc: "TEE で物理隔離" },
  { feature: "実行環境を検証できる", generic: "—", sc: "リモートアテステーション" },
  { feature: "外部アクセス先の制限", generic: "個別設定に依存", sc: "管理者ポリシーで一元強制" },
  { feature: "操作ごとの柔軟な権限設定", generic: "個別設定に依存", sc: "管理者ポリシーで一元強制" },
] as const

export function LpComparison() {
  return (
    <section id="compare" className="border-t border-slate-100 bg-[#fafbfc]">
      <div className="mx-auto max-w-[1100px] px-5 py-20 md:px-8 md:py-24">
        <div className="max-w-[760px]">
          <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-600" style={{ fontFamily: HANKEN }}>
            05 / 比較
          </div>
          <h2 className="mt-4 text-balance text-[1.6rem] font-bold leading-[1.38] tracking-tight text-slate-900 md:text-4xl">
            「信頼」で守るのか「仕組み」で守るのか。
          </h2>
          <p className="mt-5 text-[15px] leading-[1.9] text-slate-600 md:text-[16.5px]">
            一般的なエージェントの安全性は、最終的に運用元への信頼に依存します。セキュアコードは同じ観点を、信頼ではなく物理的な隔離と組織ポリシーで担保します。
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[1.4fr_1fr_1.2fr] bg-[#153658] text-white">
            <div className="px-4 py-4 text-[13px] font-semibold md:px-6 md:text-sm">観点</div>
            <div className="border-l border-slate-700 px-3 py-4 text-center text-[13px] font-semibold text-slate-300 md:px-5 md:text-sm">
              一般的なエージェント
            </div>
            <div className="border-l border-slate-700 bg-brand-600 px-3 py-4 text-center text-[13px] font-bold md:px-5 md:text-sm">
              Acompany セキュアコード
            </div>
          </div>
          {ROWS.map((row) => (
            <div key={row.feature} className="grid grid-cols-[1.4fr_1fr_1.2fr] border-b border-slate-100 last:border-b-0">
              <div className="px-4 py-4 text-[13px] font-semibold text-slate-900 md:px-6 md:py-5 md:text-[15px]">
                {row.feature}
              </div>
              <div className="border-l border-slate-100 px-3 py-4 text-[13px] text-slate-500 md:px-5 md:py-5 md:text-[15px]">
                {row.generic === "—" ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <>
                    <span className="font-bold text-slate-400">○</span> {row.generic}
                  </>
                )}
              </div>
              <div className="border-l border-slate-100 bg-brand-50 px-3 py-4 text-[13px] text-slate-800 md:px-5 md:py-5 md:text-[15px]">
                <span className="font-bold text-brand-600">◎</span> {row.sc}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-5 text-center text-[13px] leading-[1.8] text-slate-400">
          ◎ 仕組み（TEE・設定ファイル・管理者統制）で機械的に担保　／　○ 人（規約・契約・個別運用）を信頼することで担保　／　— 非対応・対象外
        </p>
      </div>
    </section>
  )
}
