// SecureCode.dc.html の 01/プロダクト。TUI ターミナルの再現ログ＋コールバンド。

const HANKEN = '"Hanken Grotesk", sans-serif'
const MONO = '"JetBrains Mono", monospace'

export function LpProduct() {
  return (
    <section id="product" className="border-t border-slate-100 bg-[#fafbfc]">
      <div className="mx-auto max-w-[1180px] px-5 py-20 md:px-8 md:py-24">
        <div className="max-w-[820px]">
          <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-600" style={{ fontFamily: HANKEN }}>
            01 / プロダクト
          </div>
          <h2 className="mt-4 text-balance text-[1.7rem] font-bold leading-[1.4] tracking-tight text-slate-900 md:text-[2.6rem]">
            ターミナルで完結する、
            <br className="hidden sm:inline" />
            安全な AI コーディングエージェント。
          </h2>
          <p className="mt-5 text-[15px] leading-[1.9] text-slate-600 md:text-[17px]">
            Claude Code や Codex と同じ使い慣れた TUI の操作感のまま、ターミナルから離れずに
            開発を進められます。新しいツールを覚え直す必要はなく、学習コストはほぼゼロです。
          </p>
        </div>

        {/* terminal */}
        <div className="mx-auto mt-12 max-w-[1040px] overflow-hidden rounded-2xl border border-slate-800 bg-[#0d1117] shadow-[0_30px_80px_rgba(15,23,42,.30)]">
          <div className="flex items-center gap-2 border-b border-[#21262d] bg-[#161b22] px-4 py-3.5">
            <span className="size-[11px] rounded-full bg-[#ef4d54]" />
            <span className="size-[11px] rounded-full bg-[#f5bf4f]" />
            <span className="size-[11px] rounded-full bg-[#5ac05a]" />
            <span className="ml-2.5 text-xs text-[#8b949e]" style={{ fontFamily: MONO }}>
              securecode · ~/project/billing
            </span>
            <span className="ml-auto text-[11.5px] text-[#58a6ff]" style={{ fontFamily: MONO }}>
              ● Gemma4
            </span>
          </div>

          <div className="overflow-x-auto px-5 py-5 text-[12px] leading-[2] sm:px-6 sm:text-[13px]" style={{ fontFamily: MONO }}>
            <div className="min-w-[22rem]">
              <div className="text-[#e6edf3]">
                <span className="text-[#58a6ff]">›</span> BillingService の月額計算に、年契約割引 15% を追加して。テストも書いて。
              </div>
              <div className="mt-2.5 text-[#8b949e]">◇ プロジェクト構成を読み込み、最小変更の方針を計画中…</div>
              <div className="mt-1 text-[#8b949e]">
                <span className="text-[#a5d6ff]">read</span> src/billing/pricing.ts <span className="text-[#6e7681]">(172 lines)</span>
              </div>
              <div className="text-[#8b949e]">
                <span className="text-[#a5d6ff]">grep</span> annual / discount <span className="text-[#6e7681]">— 4 matches</span>
              </div>
              <div className="mt-1 text-[#8b949e]">
                <span className="text-[#a5d6ff]">edit</span> src/billing/pricing.ts <span className="text-[#7ee787]">+14</span> <span className="text-[#ff7b72]">−2</span>
              </div>
              <div className="mt-1.5 rounded-lg border border-[#21262d] bg-[#161b22] px-3.5 py-3 text-[#7ee787]">
                <div>+ annual: {"{"} kind: 'annual', rate: 0.15 {"}"} as const,</div>
                <div>+ if (rule.kind === 'annual') return base * 12 * (1 - rule.rate)</div>
              </div>
              <div className="mt-2 text-[#8b949e]">
                <span className="text-[#a5d6ff]">bash</span> $ bun test packages/billing <span className="text-[#7ee787]">— 8 pass, 0 fail (412ms) ✓</span>
              </div>
              <div className="mt-2.5 text-[#e6edf3]">
                <span className="text-[#7ee787]">●</span> 年契約割引 15% を DiscountRule.annual として追加。適用は applyDiscount() の 1 行のみ。テストは 8 件すべて緑です。
              </div>
              <div className="mt-3.5 flex items-center gap-2 border-t border-[#21262d] pt-3.5 text-[#8b949e]">
                <span className="text-[#58a6ff]">$</span> Ask anything…
                <span className="inline-block h-[15px] w-2 bg-[#58a6ff] [animation:sc-blink_1.1s_steps(1)_infinite]" />
              </div>
              <div className="mt-3 flex gap-4 text-[11.5px] text-[#6e7681]">
                <span>tab agents</span>
                <span>ctrl+p commands</span>
                <span>◯ 3 MCP</span>
                <span>/status</span>
                <span className="ml-auto text-[#8b949e]">Acompany</span>
              </div>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-3.5 max-w-[1040px] text-center text-xs leading-relaxed text-slate-400">
          ※ 画面はすべて開発途中のイメージであり、実際の製品とは異なる場合があります。
        </p>

        {/* same-as callout */}
        <div className="mt-12 overflow-x-auto rounded-2xl border border-brand-100 bg-brand-50 px-6 py-8 text-center text-[1.05rem] font-bold leading-[1.4] tracking-tight text-slate-800 md:px-11 md:text-[25px]">
          <strong className="font-bold text-brand-600">Claude Code や Codex と同じ操作感のまま、</strong>
          安全性だけは一線を画す。
        </div>
      </div>
    </section>
  )
}
