# demo — Acompanyセキュアコード チュートリアル / デモサイト

Acompanyセキュアコードの **本質的な価値** をスクロールテリングで体感してもらう、
独立 Next.js サイト。

> ⚠️ このサイトは **デモ用** です。表示しているレスポンス・モデル名・トークン数・
> 指標値はすべてモックで、バックエンドや外部 API には接続していません。
> フッターでも同じ旨を明示しています。

---

## なぜ作ったか (Intent)

本体の TUI / CLI / Desktop アプリを触っただけでは、Acompanyセキュアコードが
「**機密コードを TEE 越しに LLM へ渡す**」という構造になっていることや、
ハーネス層で何を制御しているかは分かりにくい。

このデモは、インターフェース紹介ではなく以下 3 つの **本質的価値** を
段階的に理解してもらうことを目的にしている。モチーフは
[Nintendo Switch 2 「ひみつ展」](https://www.nintendo.com/jp/games/switch2/aahea/index.html)
のような縦スクロール体験。

1. **TEE による機密コードの保護** — Confidential Computing 環境内でのみ
   推論が走り、インフラ事業者・モデル提供者を含む第三者から処理中データが
   見えないこと
2. **外側からの統制で AI に自由を与える** — AI に機密を渡してよい設計だからこそ、
   外部通信先・編集可能フォルダ・連携 MCP を組織側の設定ファイル / 管理者
   アカウントから機械的に縛れること (permission-policy は実装済み、
   設定ファイル系・管理者統制系は今後の予定)
3. **生成 AI を利用した開発補助** — 上記 2 つを担保しつつ、コード生成 /
   レビュー / リファクタ / バグ修正 / テスト生成といった日常開発に組み込めること

生成 AI の利用に強い制限がかかる組織でも、機密コードを守ったまま開発支援を
成立させる、というAcompanyセキュアコードの差別化ポイントを「触って分かる」
形にしている。

---

## 構成 (What)

| ファイル | 役割 |
| --- | --- |
| `app/page.tsx` | 全セクションを縦に積む 1 枚もののランディング |
| `app/layout.tsx` | フォント / メタデータ (noindex) / グローバル CSS の取り込み |
| `app/globals.css` | Tailwind v4 設定 + Acompanyセキュアコードのカラートークン (`--color-sc-*`) |
| `components/Hero.tsx` | ピクセル wordmark + 本体 TUI を再現したターミナル |
| `components/SectionProblem.tsx` | 「なぜいまAcompanyセキュアコードか」3 リスクカード |
| `components/SectionTEE.tsx` | TEE フロー (sticky + scrollytelling) |
| `components/SectionHarness.tsx` | permission-policy (実装済) + 外部アクセス制限 + MCP 一元管理 (予定) |
| `components/SectionCoding.tsx` | AI コーディングセッションの再現 |
| `components/SectionComparison.tsx` | 一般的なコーディングエージェントとの安全性比較 |
| `components/CTA.tsx` + `Footer.tsx` | 申込み導線とデモ宣言 |

---

## ローカルで動かす (How)

### 1. dev サーバー (普段の開発)

```bash
cd demo
bun install         # 初回のみ
bun run dev         # http://localhost:4321
```

Next.js の dev server。HMR が効く。`basePath` は適用されないので URL は
ルート `/`。コンポーネント編集 → ブラウザに即反映、というフローはこっち。

### 2. 本番ビルドのプレビュー (Pages 相当)

```bash
cd demo
bun run build       # out/ に静的サイトを書き出す
bun run preview     # http://localhost:4321 (out/ を静的サーブ)
```

GitHub Pages 上の挙動を手元で再現したい時はこっち。`bun run preview` は
`bun x serve out --listen 4321` のショートカット (内部で `serve` パッケージを
on-the-fly で起動する。devDependency への追加は不要)。

本番は root 配信 (basePath なし) なので、`bun run preview` の挙動が
本番と一致する。`NEXT_PUBLIC_BASE_PATH` をセットすれば任意のサブパス
配信も再現可能 (履歴上、以前 `acompany-develop.github.io/securecode/demo/`
で配信していたときの確認に使う)。

### 3. 型チェック

```bash
bun run typecheck
```

---

## 技術詳細

### スタック

- **Next.js 15** (App Router) — static export モードで使用
- **React 19**
- **Tailwind CSS v4** (`@tailwindcss/postcss`)
- **framer-motion** — `useScroll` / `useTransform` でスクロール連動
- **TypeScript 5**

### static export 構成

`next.config.ts` で以下を設定:

```ts
output: "export"          // SSG のみ。SSR / API Routes は使わない
basePath:  process.env.NEXT_PUBLIC_BASE_PATH ?? ""
assetPrefix: basePath || undefined
trailingSlash: true       // GitHub Pages 互換 (index.html ベース)
images: { unoptimized: true }  // next/image の最適化サーバーを無効化
```

`basePath` は環境変数経由なので、サブパス配信したいときだけ
`NEXT_PUBLIC_BASE_PATH=/foo bun run build` のように差し込める。本番は
カスタムドメインを root に紐付けて配信するので、CI でも env を渡さず
空文字 (= root) のままビルドしている。

### GitHub Pages デプロイ

`.github/workflows/pages.yml` が以下のフローで配信する:

1. `push: dev` ブランチで `demo/**` または同 workflow が変更されたら起動
2. `oven-sh/setup-bun@v2` → `bun install --frozen-lockfile`
3. `bun run build` (basePath は空 = root 配信)
4. `out/` をそのまま `_site/` にコピー、`_site/CNAME` にカスタムドメイン名、`_site/.nojekyll` を touch
5. `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4`

公開 URL: `https://securecode.acompany.tech/`
(設定が伝播するまでの暫定 URL: `https://acompany-develop.github.io/securecode/`)

#### 初回 1 度だけ手動でやること

1. リポジトリ Settings → Pages → **Build and deployment**:
   - **Source**: GitHub Actions
   - **Custom domain**: `securecode.acompany.tech`
   - **Enforce HTTPS** をオン (証明書発行を待ってからオンにする)
2. XServer の DNS 設定で CNAME を追加:
   - ホスト名: `securecode`
   - 種別: `CNAME`
   - 内容: `acompany-develop.github.io.`
3. 伝播後 GitHub Pages が Let's Encrypt 証明書を自動発行 (数分〜数時間)。
   `curl -I https://securecode.acompany.tech/` が 200 を返せば完了。

### アクセス計測 (Google Tag Manager)

`app/layout.tsx` で `@next/third-parties/google` の `GoogleTagManager`
を使ってる。container ID は build 時の env `NEXT_PUBLIC_GTM_ID` で
差し込む形にしてあるので、リポに ID を埋め込まない。

#### GTM を有効化する手順

1. GTM (`tagmanager.google.com`) で demo 用 container を新規作成
   (もしくは既存 `service.acompany.tech` の container を流用)
2. 発行された container ID (`GTM-XXXXXXX` 形式) を取得
3. リポジトリ Settings → Secrets and variables → Actions → **Variables** タブ:
   - 名前: `DEMO_GTM_ID`
   - 値: `GTM-XXXXXXX`
4. `dev` ブランチへの push (or `Deploy demo to GitHub Pages` workflow を
   手動 dispatch) で Pages が再 build されると、`<head>` に GTM の
   snippet が注入され、`<body>` 直後に noscript iframe が入る
5. GTM 側で **GA4 設定タグ** を作って GA4 プロパティに接続する
   (これをしないと GTM だけ入って GA4 にデータが流れない)

#### ローカル動作確認時

ローカル `bun run dev` では env を渡さないので `NEXT_PUBLIC_GTM_ID` が
undefined → `<GoogleTagManager>` をレンダリングしない → 本番計測を
汚さない。GTM 動作確認を local でも見たい時は環境変数を上書きする:

```bash
NEXT_PUBLIC_GTM_ID=GTM-XXXXXXX bun run dev
```

#### Cookie / 同意バナーについて

GA4 が自動で永続 Cookie (`_ga` 等、13 か月) を発行する。EU 訪問者向けに
consent banner が必要なら別途実装 (Consent Mode v2 を `@next/third-parties`
の `sendGTMEvent` で連動させるパターンが一般的)。今のところ日本向け
public-beta 段階なら未実装でも実害は無い。

#### なぜ `next start` ではなく `bun x serve` でプレビューするのか

`output: "export"` を有効にすると `next start` は使えなくなる
([Next.js docs](https://nextjs.org/docs/app/guides/static-exports#unsupported-features))。
そこで `bun run preview` には汎用静的サーバーである `serve` を使い、
本番 (= GitHub Pages 上の静的配信) と同じ挙動でプレビューできるようにしている。

### 本体への依存と参照元

本体に寄せるため次を参照してデザインを起こしている (移植元):

- `github/assets/top-secure-code.png`, `models-secure-code.png` — TUI スプラッシュ
- `packages/ui/src/components/logo.tsx` — wordmark の ASCII art
- `packages/ui/src/styles/colors.css` — Radix スケール由来のカラートークン
- `packages/opencode/src/securecode/plugins/secret-mask.ts` — マスキング挙動の実例
- `packages/opencode/src/securecode/plugins/overflow-guard.ts` — head+tail 切り詰めの実例

ランタイムでは本体パッケージに依存していない (デモは完全に独立した Next.js
プロジェクト)。`bun.lock` も `demo/` 内のものを使う。

---

## 既知の留意点

- **`next start` は動かない**: `output: "export"` の副作用。代わりに
  `bun run preview` を使う
- **`prefers-reduced-motion` 未対応**: SVG の `<motion.path strokeDashoffset>`
  などは framer-motion で `prefers-reduced-motion` を読まない。低モーション
  環境向けに Tailwind の `motion-reduce:*` で抑える対応が TODO
- **Safari 旧版**: `position: sticky` の解除がもたつく場合がある
- **モック値**: スタックトレース / トークン数 / モデル名は全て本番と異なる
