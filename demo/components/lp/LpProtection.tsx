// SecureCode.dc.html の 03/仕組み1（TEE）。「TEEとは？」解説＋Local⇄Remote アーキ図。

const HANKEN = '"Hanken Grotesk", sans-serif'
const MONO = '"JetBrains Mono", monospace'
const BLOG = "https://www.acompany.tech/privacytechlab/trusted-execution-environment"

const MINI = [
  { t: "ハードウェアで隔離", d: "ソフト設定ではなく CPU・GPU の機構そのもので分離。" },
  { t: "暗号鍵も内部で完結", d: "復号鍵が TEE の外に出ないため平文を抜けない。" },
  { t: "正規の環境か検証できる", d: "送信前に、改ざんされていない本物の隔離領域かを確認（リモートアテステーション）。" },
] as const

const TEE_STEPS = [
  "① リモートアテステーションで環境を検証",
  "② 受け取った入力を TEE 内だけで処理",
  "③ 推論結果・指示を返送（平文は外に出ない）",
] as const

export function LpProtection() {
  return (
    <section id="tee" className="bg-white">
      <div className="mx-auto max-w-[1180px] px-5 py-20 md:px-8 md:py-24">
        <div className="max-w-[840px]">
          <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-600" style={{ fontFamily: HANKEN }}>
            03 / 仕組み 1
          </div>
          <h2 className="mt-4 text-balance text-[1.7rem] font-bold leading-[1.38] tracking-tight text-slate-900 md:text-[2.6rem]">
            AI 推論を TEE で物理的に隔離する。
            <br className="hidden sm:inline" />
            誰も中を覗けない。
          </h2>
          <p className="mt-5 text-[15px] leading-[1.9] text-slate-600 md:text-[17px]">
            推論はすべて隔離された領域の中だけで行われ、インフラ事業者やモデル提供者を含む第三者は処理中のデータを参照できません。「信頼」ではなく「ハードウェアの仕組み」で機密を守ります。
          </p>
        </div>

        {/* TEEとは？ explainer */}
        <div className="mt-11 flex flex-wrap items-start gap-8 rounded-2xl border border-brand-100 bg-brand-50 p-7 md:gap-10 md:p-9">
          <div className="min-w-[300px] flex-[1.3]">
            <div className="inline-flex items-center gap-2 text-[13px] font-bold text-brand-600">
              <span className="flex size-[22px] items-center justify-center rounded-md bg-brand-600 text-sm text-white">?</span>
              TEE とは？
            </div>
            <div className="mt-3.5 text-xl font-bold leading-snug text-slate-900">
              Confidential Computing 環境（TEE / Trusted Execution Environment）
            </div>
            <p className="mt-3.5 text-[15px] leading-[1.9] text-slate-600">
              CPU や GPU の中に作られる「鍵のかかった隔離領域」です。外部から閲覧できないことが保証されており、インフラ事業者やモデル提供者、そしてサービス提供者である Acompany
              でさえも読み取れません。
              <br />
              そのため、送信したデータが閲覧されることも、学習に使われることも、外部の攻撃で漏洩することも決してありません。
            </p>
            <a href={BLOG} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-brand-600">
              TEE の詳しい解説を読む →
            </a>
          </div>
          <div className="flex min-w-[280px] flex-1 flex-col gap-3">
            {MINI.map((m) => (
              <div key={m.t} className="rounded-xl border border-brand-100 bg-white px-4 py-4">
                <div className="text-[15px] font-bold text-slate-900">{m.t}</div>
                <div className="mt-1.5 text-[13.5px] leading-[1.7] text-slate-500">{m.d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* architecture */}
        <div className="mt-12 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400" style={{ fontFamily: HANKEN }}>
          Architecture
        </div>
        <div className="mt-5 grid items-stretch gap-4 rounded-[18px] border border-slate-200 bg-[#fafbfc] p-5 md:grid-cols-[1fr_auto_1.25fr] md:p-9">
          {/* LOCAL */}
          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500" style={{ fontFamily: HANKEN }}>
              Local · ユーザーの環境
            </span>
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-[#0d1117]">
              <div className="flex items-center gap-1.5 border-b border-[#21262d] bg-[#161b22] px-3 py-2.5">
                <span className="size-2 rounded-full bg-[#ef4d54]" />
                <span className="size-2 rounded-full bg-[#f5bf4f]" />
                <span className="size-2 rounded-full bg-[#5ac05a]" />
                <span className="ml-1.5 text-[10.5px] text-[#8b949e]" style={{ fontFamily: MONO }}>securecode · TUI</span>
              </div>
              <div className="px-3.5 py-3 text-[11.5px] leading-[1.85]" style={{ fontFamily: MONO }}>
                <div className="text-[#e6edf3]"><span className="text-[#58a6ff]">›</span> このコードを直して</div>
                <div className="mt-1 text-[#6e7681]">attach: <span className="text-[#a5d6ff]">src/billing/pricing.ts</span></div>
              </div>
            </div>
            <div className="relative mt-5 rounded-xl border-[1.5px] border-slate-300 bg-white p-5">
              <span className="absolute -top-2.5 left-4 rounded-md bg-slate-600 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white" style={{ fontFamily: HANKEN }}>
                ハーネス
              </span>
              <p className="mt-1.5 text-[13px] leading-[1.7] text-slate-600">
                AI の操作はこの枠の中で実行され、ポリシーで制御されます。
              </p>
              <div className="mt-3.5 flex flex-col gap-2">
                {["コマンド実行", "ファイル読み書き・外部通信"].map((t) => (
                  <div key={t} className="rounded-lg border border-slate-200 bg-[#fafbfc] px-3 py-2.5 text-[12.5px] text-slate-800">
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* channel */}
          <div className="flex min-w-[110px] flex-row items-center justify-center gap-2 px-3.5 md:flex-col">
            <div className="flex items-center text-brand-600 md:w-full">
              <span className="h-0.5 flex-1 bg-gradient-to-r from-slate-300 to-brand-600" />
              <span className="mx-0.5 rotate-90 md:rotate-0">▶</span>
            </div>
            <div className="text-[11.5px] text-slate-400" style={{ fontFamily: MONO }}>HTTPS 通信</div>
            <div className="flex items-center text-brand-600 md:w-full">
              <span className="mx-0.5 rotate-90 md:rotate-0">◀</span>
              <span className="h-0.5 flex-1 bg-gradient-to-r from-brand-600 to-slate-300" />
            </div>
          </div>

          {/* REMOTE (TEE) */}
          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500" style={{ fontFamily: HANKEN }}>
                Remote · クラウド
              </span>
              <span className="text-xs text-slate-400">Acompany / インフラ事業者</span>
            </div>
            <div className="mt-2.5 text-xs leading-relaxed text-slate-400">運用者でもこの枠の内側は覗けません</div>
            <div className="relative mt-3 flex-1 rounded-xl border-[1.5px] border-brand-600 bg-brand-50 p-5 shadow-[0_12px_30px_rgba(13,104,160,.14)]">
              <span className="absolute -top-2.5 left-4 rounded-md bg-brand-600 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white" style={{ fontFamily: HANKEN }}>
                TEE 隔離領域
              </span>
              <div className="flex justify-end">
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10.5px] text-emerald-700" style={{ fontFamily: MONO }}>✓ attested</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex size-[46px] shrink-0 items-center justify-center rounded-xl bg-brand-600 text-[22px] shadow-[0_6px_16px_rgba(13,104,160,.3)]">🤖</div>
                <div>
                  <div className="text-[17px] font-bold leading-snug text-slate-900">この中で AI が動く</div>
                  <div className="mt-0.5 text-[13px] leading-relaxed text-slate-600">TEE 内で LLM 推論を実行。</div>
                </div>
              </div>
              <div className="mt-3.5 flex flex-col gap-2">
                {TEE_STEPS.map((s) => (
                  <div key={s} className="rounded-lg border border-brand-100 bg-white px-3 py-2.5 text-[12.5px] text-slate-800">
                    {s}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-[13px] leading-[1.8] text-slate-400">
          平文を扱うのは TEE の隔離領域の内部に限られ、AI もその中で動きます。
        </p>
      </div>
    </section>
  )
}
