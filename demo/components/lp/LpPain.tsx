"use client"

// SecureCode.dc.html の 02/課題。3つの壁（赤バッジ）＋「仕組み」への橋渡し。

const HANKEN = '"Hanken Grotesk", sans-serif'

const WALLS = [
  {
    no: "壁1",
    tag: "機密漏洩",
    title: "インフラもモデル提供者も、信頼するしかない",
    body: "推論はインフラ事業者を経由し、モデルは提供者が運用します。データ取扱いは規約に基づきますが、最終的には両者の運用と特権アクセス管理を信頼する前提になります。",
  },
  {
    no: "壁2",
    tag: "学習利用",
    title: "学習に使われない保証は契約だけ",
    body: "API では入力が学習に使われるリスクがあり、オプトアウトしてもログ保管は残ります。結局「提供者を信頼する」契約で縛っているに過ぎません。",
  },
  {
    no: "壁3",
    tag: "権限リスク",
    title: "AI に強い権限を与えるリスク",
    body: "エージェントはファイル編集・シェル実行・外部通信を行います。権限委譲は効率化に不可欠ですが、その分インシデントリスクも増していきます。",
  },
] as const

const BRIDGES = [
  {
    walls: "壁 1・2 の解決",
    title: "TEE で物理的に隔離する",
    desc: "漏えいも学習利用も、規約ではなくハードウェアの隔離で防ぐ。",
    href: "#tee",
    cta: "仕組み 1 を見る →",
  },
  {
    walls: "壁 3 の解決",
    title: "ハーネスで権限を統制する",
    desc: "AI の操作・通信を組織ポリシーで機械的に縛る。",
    href: "#harness",
    cta: "仕組み 2 を見る →",
  },
] as const

export function LpPain() {
  return (
    <section id="problem" className="bg-white">
      <div className="mx-auto max-w-[1180px] px-5 py-20 md:px-8 md:py-24">
        <div className="max-w-[760px]">
          <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-600" style={{ fontFamily: HANKEN }}>
            02 / 課題
          </div>
          <h2 className="mt-4 text-balance text-[1.75rem] font-bold leading-[1.4] tracking-tight text-slate-900 md:text-[2.5rem]">
            便利さの裏で、機密コードを抱える組織だけが取り残されている。
          </h2>
          <p className="mt-5 text-[15px] leading-[1.9] text-slate-600 md:text-[17px]">
            AI コーディングはスタンダードになりつつあります。しかし機密ソースコードを扱う組織にとって、
            既存ツールの導入には越えられない
            <strong className="font-bold text-slate-900">3つの壁</strong>
            があります。
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {WALLS.map((w) => (
            <div key={w.no} className="rounded-2xl border border-slate-200 bg-white p-7 transition-shadow hover:shadow-[0_14px_32px_rgba(13,40,80,.10)]">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center rounded-md bg-red-50 px-2.5 py-1 text-xs font-bold tracking-wide text-red-600">
                  {w.no}
                </span>
                <span className="text-[13px] font-bold tracking-wide text-slate-900">{w.tag}</span>
              </div>
              <div className="mt-3.5 text-[19px] font-bold leading-snug text-slate-900">{w.title}</div>
              <p className="mt-3 text-[14.5px] leading-[1.85] text-slate-500">{w.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center text-center">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400" style={{ fontFamily: HANKEN }}>
            So how we solve it
          </div>
          <div className="mt-3 text-balance text-xl font-bold leading-snug text-slate-900 md:text-2xl">
            この3つの壁を、「信頼」ではなく<span className="text-brand-600">「仕組み」</span>で越える。
          </div>
          <div className="mt-2.5 text-2xl leading-none text-slate-300">↓</div>

          <div className="mt-5 grid w-full max-w-[880px] gap-5 text-left md:grid-cols-2">
            {BRIDGES.map((b) => (
              <a
                key={b.href}
                href={b.href}
                className="block rounded-2xl border border-brand-100 bg-brand-50 p-6 transition-shadow hover:shadow-[0_14px_32px_rgba(13,40,80,.10)]"
              >
                <span className="text-[11px] font-bold uppercase tracking-[0.13em] text-brand-600" style={{ fontFamily: HANKEN }}>
                  {b.walls}
                </span>
                <div className="mt-2.5 text-[18px] font-bold text-slate-900">{b.title}</div>
                <p className="mt-2 text-sm leading-[1.8] text-slate-600">{b.desc}</p>
                <span className="mt-2 block text-sm font-bold text-brand-600">{b.cta}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
