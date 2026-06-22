// SecureCode.dc.html の Credibility 帯（3カラム）を忠実に再現。

const ITEMS = [
  {
    title: "Confidential Computingの専門企業",
    body: (
      <>Privacy Tech／Confidential Computing を専門に手がける Acompany が開発。</>
    ),
  },
  {
    title: "Confidential AI Suite",
    body: <>機密を守ったまま生成 AI を使う製品群。その第 2 弾がセキュアコード。</>,
  },
  {
    title: "姉妹製品の実績",
    body: (
      <>
        同様のセキュリティコンセプトを持った AI チャットアプリ「
        <a
          href="https://service.acompany.tech/cas/secure-chat/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-600 underline underline-offset-2"
        >
          セキュアチャット
        </a>
        」を提供中。
      </>
    ),
  },
] as const

export function LpCredibility() {
  return (
    <section className="border-y border-slate-100 bg-[#f5f7fa]">
      <div className="mx-auto max-w-[1080px] px-5 py-8 md:px-8 md:py-9">
        <p className="text-center text-xs font-semibold tracking-[0.14em] text-slate-400">
          株式会社 Acompany が開発・運営する Confidential AI Suite の製品です
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {ITEMS.map((it) => (
            <div key={it.title} className="text-center">
              <div className="text-[15px] font-bold text-slate-900">{it.title}</div>
              <p className="mt-1.5 text-[13px] leading-[1.7] text-slate-500">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
