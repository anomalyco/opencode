// SecureCode.dc.html の 04/仕組み2（ハーネス）。権限ゲート＋OSサンドボックス＋管理者統制。

const HANKEN = '"Hanken Grotesk", sans-serif'
const MONO = '"JetBrains Mono", monospace'

const MCP_ROWS = [
  { name: "github", status: "APPROVED", cls: "text-emerald-700 bg-emerald-50", muted: false },
  { name: "confluence-internal", status: "APPROVED", cls: "text-emerald-700 bg-emerald-50", muted: false },
  { name: "slack-mcp", status: "PENDING", cls: "text-amber-700 bg-amber-50", muted: false },
  { name: "random-3rd-party", status: "BLOCKED", cls: "text-red-700 bg-red-50", muted: true },
] as const

export function LpHarness() {
  return (
    <section id="harness" className="bg-white">
      <div className="mx-auto max-w-[1180px] px-5 py-20 md:px-8 md:py-24">
        <div className="max-w-[780px]">
          <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-600" style={{ fontFamily: HANKEN }}>
            04 / 仕組み 2
          </div>
          <h2 className="mt-4 text-[1.7rem] font-bold leading-[1.35] tracking-tight text-slate-900 md:text-[2.6rem]">
            AI に自由を、運用に統制を。
          </h2>
          <p className="mt-5 text-[15px] leading-[1.9] text-slate-600 md:text-[17px]">
            機密コードを丸ごと渡してよい設計だからこそ、AI が出す操作・通信を組織側から縛れることが
            重要です。OS サンドボックスと送信先の allowlist で、AI と開発者の双方を信頼せずに
            安全性を担保します。
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {/* 権限ゲート */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="p-6 md:p-7">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-600" style={{ fontFamily: HANKEN }}>
                Policy ・ 権限ゲート
              </div>
              <div className="mt-3 text-[21px] font-bold leading-snug text-slate-900">危険な操作は必ず人間で止める</div>
              <div className="mt-3.5 flex flex-col gap-2.5 text-sm leading-relaxed text-slate-600">
                {[
                  "shell・write・edit 系 tool に粒度別の許可ポリシー",
                  "プロジェクトごとに allow / ask / deny を設定",
                  "監査ログに残り、誰が何を承認したか後追いできる",
                ].map((t) => (
                  <div key={t} className="flex gap-2.5">
                    <span className="text-brand-600">▪</span>
                    {t}
                  </div>
                ))}
              </div>
            </div>
            <div className="mx-6 mb-6 rounded-xl bg-[#0d1117] px-4 py-4 text-[12.5px] leading-[1.9] md:mx-7 md:mb-7" style={{ fontFamily: MONO }}>
              <div className="text-[#f5bf4f]">● tool requested: <span className="text-[#e6edf3]">bash</span></div>
              <div className="mt-1 text-[#ff7b72]">$ rm -rf /var/lib/secrets/*</div>
              <div className="mt-1.5 text-[#8b949e]">policy: <span className="text-[#f5bf4f]">ask</span> · matched destructive_rm</div>
              <div className="text-[#8b949e]">approve? [y/n]</div>
              <div className="mt-1 text-[#ff7b72]">✕ denied by user</div>
            </div>
          </div>

          {/* OS サンドボックス */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="p-6 md:p-7">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-600" style={{ fontFamily: HANKEN }}>
                Guardrail ・ OS サンドボックス
              </div>
              <div className="mt-3 text-[21px] font-bold leading-snug text-slate-900">通信先を OS レベルで縛る</div>
              <div className="mt-3.5 flex flex-col gap-2.5 text-sm leading-relaxed text-slate-600">
                {[
                  "エージェントはサンドボックス環境の中で起動",
                  "外部通信できるエンドポイント・読み書き可能なファイルをサンドボックスの外側で制御",
                ].map((t) => (
                  <div key={t} className="flex gap-2.5">
                    <span className="text-brand-600">▪</span>
                    {t}
                  </div>
                ))}
              </div>
            </div>
            <div className="mx-6 mb-6 rounded-xl bg-[#0d1117] px-4 py-4 text-[12px] leading-[1.85] md:mx-7 md:mb-7" style={{ fontFamily: MONO }}>
              <div className="text-[#6e7681]"># ~/.config/securecode/sandbox.json</div>
              <div className="mt-1 text-[#79c0ff]">&quot;network&quot;: {"{"}</div>
              <div className="text-[#a5d6ff]">　&quot;default&quot;: <span className="text-[#ff7b72]">&quot;deny&quot;</span>,</div>
              <div className="text-[#a5d6ff]">　&quot;allow&quot;: [ <span className="text-[#7ee787]">&quot;github.com&quot;</span> ]</div>
              <div className="text-[#79c0ff]">{"}"}</div>
              <div className="mt-1.5 text-[#8b949e]">→ それ以外への HTTPS / SOCKS5 は遮断</div>
            </div>
          </div>
        </div>

        {/* 管理者統制 */}
        <div className="mt-6 flex flex-wrap items-center gap-8 rounded-2xl border border-slate-200 bg-[#fafbfc] p-7 md:gap-10 md:p-8">
          <div className="min-w-[280px] flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-600" style={{ fontFamily: HANKEN }}>
              Governance ・ 管理者統制
            </div>
            <div className="mt-3 text-[21px] font-bold leading-snug text-slate-900">連携 MCP・接続先は管理者が一元管理</div>
            <p className="mt-3.5 text-[14.5px] leading-[1.85] text-slate-500">
              接続可能な MCP サーバーや外部通信先を、管理者アカウントで統制できます。ポリシー変更は
              監査ログ付きで追跡できます。
            </p>
          </div>
          <div className="min-w-[300px] flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white" style={{ fontFamily: MONO }}>
            <div className="border-b border-slate-100 bg-[#f7f8fb] px-4 py-2.5 text-[11.5px] tracking-wide text-slate-500">
              Admin Console · MCP allowlist (org: acompany)
            </div>
            {MCP_ROWS.map((r) => (
              <div key={r.name} className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-[12.5px] last:border-b-0">
                <span className={r.muted ? "text-slate-500" : "text-slate-900"}>{r.name}</span>
                <span className={`rounded px-2 py-0.5 text-[11px] ${r.cls}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
          ※ 画面はすべて開発途中のイメージであり、実際の製品とは異なる場合があります。
        </p>
      </div>
    </section>
  )
}
