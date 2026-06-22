// 「ローカル環境」と「秘密計算環境(TEE)」の2つの場所の“往復”で守られる、を
// 一目で伝える図。コードもエージェントもローカルにあり、TEE(リモート)へ
// 暗号化して送り、結果を暗号化して受け取って、ローカルのエージェントが適用する。
// 送信元と適用先は同じローカル環境なので、1直線ではなく往復として描く。
//
// もとはヒーロー右に置いていたが、ファーストビューの密度を下げるため
// 「解決のしくみ」セクションへ移設。清書画像が用意できたら LpMediaSlot に
// 差し替えてもよい。

// ローカルに複数のファイルがある様子を見せるためのサンプル（表示専用）
const LOCAL_FILES = ["src/billing.ts", "config.yaml", "schema.prisma"] as const

export function LpFlowDiagram() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.15)] md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">守られるしくみ</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          送信前に環境を検証
        </span>
      </div>

      {/* ローカル環境（送信元 = 適用先。同じ場所） */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          あなたの開発環境（ローカル）
        </div>
        <div className="flex items-center gap-3">
          <IconBox tone="slate">
            <PcIcon />
          </IconBox>
          <div>
            <div className="text-sm font-semibold text-slate-900">
              コーディングエージェント
            </div>
            <p className="text-xs text-slate-600">
              手元のファイル群を参照しながら動く
            </p>
          </div>
        </div>

        {/* ローカルにある複数ファイルを参照しているイメージ */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            ローカルのファイル
          </div>
          <ul className="space-y-1">
            {LOCAL_FILES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-xs text-slate-600">
                <FileIcon />
                <span className="font-mono">{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <ShieldCheckIcon />
          <p className="text-xs leading-relaxed text-slate-700">
            ファイル編集・コマンド実行は
            <strong className="font-semibold text-slate-900">ハーネスで統制</strong>
          </p>
        </div>
      </div>

      {/* 往復コネクタ（送信↓ / 返す↑） */}
      <RoundTrip />

      {/* 秘密計算環境（リモート・封印された箱） */}
      <div className="rounded-xl border-2 border-blue-200 bg-blue-50/70 p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
          秘密計算環境（TEE）／ リモート
        </div>
        <div className="flex items-center gap-3">
          <IconBox tone="blue">
            <ShieldLockIcon />
          </IconBox>
          <div>
            <div className="text-sm font-bold text-slate-900">鍵のかかった隔離領域</div>
            <p className="text-xs text-slate-600">外部から遮断された環境</p>
          </div>
        </div>

        {/* この隔離領域の「中で」AI が動いていることを示す */}
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-100 bg-white/80 px-3 py-2">
          <AiIcon />
          <p className="text-xs leading-relaxed text-slate-700">
            この中で
            <strong className="font-semibold text-slate-900">AIモデルが推論</strong>
            。コードを復号して処理し、終われば平文は残さない
          </p>
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-lg border border-blue-100 bg-white/80 px-3 py-2">
          <EyeOffIcon />
          <p className="text-xs leading-relaxed text-slate-700">
            提供元のAcompanyも、インフラ事業者・モデル提供者も
            <strong className="font-semibold text-slate-900">決して中身を見ることが出来ない</strong>
          </p>
        </div>
      </div>

      <p className="mt-5 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
        <span className="font-medium text-slate-600">「検証」とは</span>
        ：コードを送る前に、改ざんされていない正規の秘密計算環境かどうかを確かめるしくみ（リモートアテステーション）です。
      </p>
    </div>
  )
}

// ローカル ⇄ TEE の往復を、下り(送信)と上り(返す)の2本の矢印で表す。
function RoundTrip() {
  return (
    <div className="flex items-stretch justify-center gap-10 py-3">
      <div className="flex flex-col items-center gap-1">
        <DownArrow />
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
          <LockIcon />
          暗号化して送信
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <UpArrow />
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
          <LockIcon />
          暗号化して返す
        </span>
      </div>
    </div>
  )
}

function IconBox({
  tone,
  children,
}: {
  tone: "slate" | "blue"
  children: React.ReactNode
}) {
  const cls = tone === "blue" ? "bg-blue-700 text-white" : "bg-slate-200 text-slate-600"
  return (
    <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${cls}`}>
      {children}
    </span>
  )
}

function DownArrow() {
  return (
    <svg className="size-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v15" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  )
}

function UpArrow() {
  return (
    <svg className="size-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  )
}

function PcIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg className="size-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M5 21V5a2 2 0 0 1 2-2h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

// 秘密計算環境（盾＋鍵）のアイコン
function ShieldLockIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 5 6v5c0 4.4 3 8.4 7 9.5 4-1.1 7-5.1 7-9.5V6l-7-3Z" />
      <path d="M12 11v3" />
      <circle cx="12" cy="10.5" r="0.6" fill="currentColor" />
    </svg>
  )
}

// 隔離領域の「中で」動く AI を表すスパークル（AI）アイコン
function AiIcon() {
  return (
    <svg className="size-4 shrink-0 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 3.5 12.6 8 17 9.5 12.6 11 11 15.5 9.4 11 5 9.5 9.4 8z" />
      <path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg className="size-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c5 0 9 4 10 8a13 13 0 0 1-2.2 3.3M6.6 6.6A13 13 0 0 0 2 12c1 4 5 8 10 8 1.6 0 3.1-.4 4.4-1.1" />
      <path d="m3 3 18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

function ShieldCheckIcon() {
  return (
    <svg className="size-4 shrink-0 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 5 6v5c0 4.4 3 8.4 7 9.5 4-1.1 7-5.1 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
