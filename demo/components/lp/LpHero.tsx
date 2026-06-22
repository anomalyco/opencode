// SecureCode.dc.html の Hero を忠実に再現（中央寄せ・バッジ・3カード）。
// レスポンシブ化のため、3カードはモバイルで1カラムに、見出しは段階的に縮小。

const HANKEN = '"Hanken Grotesk", sans-serif'

const CARDS = [
  {
    label: "01 — Isolate",
    title: "物理で隔離する",
    body: (
      <>
        <span className="whitespace-nowrap">CPU・GPU 内に</span>
        物理的に隔離した領域（Confidential Computing 環境）で推論。運用者でも平文を覗けません。
      </>
    ),
  },
  {
    label: "02 — Verify",
    title: "仕組みで検証する",
    body: "リモートアテステーションにより、ユーザ自身がサーバーの挙動を常に検証できます。",
  },
  {
    label: "03 — Govern",
    title: "組織で統制する",
    body: "AI が触れない管理者ポリシーで、操作と外部通信を一元制御します。",
  },
] as const

export function LpHero() {
  return (
    <section
      id="top"
      className="relative"
      style={{
        background:
          "radial-gradient(120% 70% at 50% -10%, var(--color-brand-50) 0%, #ffffff 60%)",
      }}
    >
      <div className="mx-auto flex max-w-[1180px] flex-col items-center px-5 pb-16 pt-24 text-center md:px-8 md:pb-20 md:pt-28">
        <div
          className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-600"
          style={{ fontFamily: HANKEN }}
        >
          Confidential AI Suite
        </div>

        <h1 className="mt-7 max-w-[940px] text-balance text-[2.1rem] font-bold leading-[1.25] tracking-tight text-slate-900 sm:text-5xl md:text-[4rem] md:leading-[1.2]">
          機密コードを外に出さずに
          <br />
          <span className="text-brand-600">AI コーディングを。</span>
        </h1>

        <p className="mt-7 max-w-[680px] text-[15px] leading-[1.9] text-slate-600 md:text-lg">
          「セキュリティ上、生成 AI は使えない」を終わらせる。TEE による物理隔離と組織ポリシーで、
          機密ソースコードを守ったまま AI 開発を解禁します。
        </p>

        <div className="mt-9 flex flex-col gap-3.5 sm:flex-row">
          <a
            href="#waitlist"
            className="inline-flex items-center justify-center gap-1.5 rounded-[9px] bg-brand-600 px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_6px_18px_rgba(13,104,160,.30)] transition-colors hover:bg-brand-700"
          >
            ウェイトリストに登録 →
          </a>
          <a
            href="#apply"
            className="inline-flex items-center justify-center rounded-[9px] border border-slate-300 bg-white px-7 py-3.5 text-[15px] font-semibold text-slate-800 transition-colors hover:border-brand-600 hover:bg-brand-50 hover:text-brand-600"
          >
            導入を相談する
          </a>
        </div>

        <div className="mt-16 grid w-full max-w-[1000px] gap-4 md:mt-[72px] md:grid-cols-3">
          {CARDS.map((c) => (
            <div
              key={c.label}
              className="rounded-2xl border border-slate-200 bg-white p-7 text-left transition-shadow hover:shadow-[0_14px_32px_rgba(13,40,80,.10)]"
            >
              <div
                className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600"
                style={{ fontFamily: HANKEN }}
              >
                {c.label}
              </div>
              <div className="mt-3.5 text-[19px] font-bold text-slate-900">{c.title}</div>
              <p className="mt-2.5 text-sm leading-[1.8] text-slate-500">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
