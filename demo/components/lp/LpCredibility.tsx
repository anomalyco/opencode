// 信頼シグナルの帯。広告から来た初見の訪問者に「これは実在する会社の
// まっとうな製品だ」と最初に伝える。誇大な実績を並べるのではなく、事実
// （運営会社・製品ラインナップ・姉妹製品）を淡々と提示して安心させる。

export function LpCredibility() {
  return (
    <section className="border-y border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-center text-xs font-medium tracking-wider text-slate-400">
          株式会社Acompanyが開発・運営するConfidential AI Suiteの製品です
        </p>
        <div className="mt-5 grid gap-4 text-center sm:grid-cols-3">
          <Item
            title="秘密計算の専門企業"
            body="プライバシーテック / 秘密計算を専門に手がけるAcompanyが開発"
          />
          <Item
            title="Confidential AI Suite"
            body="機密を守ったまま生成AIを使う製品群。その第2弾がセキュアコード"
          />
          <Item
            title="姉妹製品の実績"
            body={
              <>
                社内向けチャット{" "}
                <a
                  href="https://service.acompany.tech/cas/secure-chat/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
                >
                  セキュアチャット
                </a>{" "}
                を同じ思想で提供中
              </>
            }
          />
        </div>
      </div>
    </section>
  )
}

function Item({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-sm font-semibold text-slate-900">{title}</span>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">{body}</p>
    </div>
  )
}
