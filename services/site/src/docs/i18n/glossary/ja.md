# 日本語 (ja) ドキュメント翻訳用語集

`src/docs/content/ja/` の V2 ドキュメント翻訳で使う用語と表記ルール。共通用語は `../glossary.md` に従い、このファイルは日本語固有の決定を記録する。

## 表記ルール

- 本文は です・ます調。体言止めや「〜してください」を混ぜ、英語の命令形は「〜します」「〜してください」に対応させる。
- 日本語と英数字の間には半角スペースを入れる（`OpenCode の設定`、`API キー`、`5 分`、`3 つ`）。全角約物（、。（）：？「」）の前後には入れない。
- 句読点は全角の 、。 を使い、コロン・括弧・疑問符は全角の ：（）？ を使う。引用符は 「」。
- 見出しでは文末の句点を付けない。英語見出しが疑問文でも、自然な日本語の名詞句か平叙文にする。
- 数値・価格・上限・バージョン・モデル ID・日付は英語のまま正確に。
- 英語の UI ラベルを引用する太字（例 **Settings › Billing**、**Add credits**）は英語のまま。
- コード、コマンド、フラグ、設定キー、環境変数、パス、URL、MDX コンポーネントと props は変更しない。フェンス付きコードブロックはバイト単位で同一にする（`title="opencode.jsonc"` などの info string も含む）。
- 内部リンクは英語と同じルート相対（`/config`）のまま。リンクテキストだけ翻訳する。
- 見出しの数・順序・深さは英語と完全に一致させる（アンカー id が英語見出しの位置で再利用されるため）。
- 箇条書きの項目数、表の行数、注記の有無を英語と一致させる。省略も追加もしない。
- 製品名・モデル名・会社名・アプリ名は英語のまま。

## 用語

| English | 日本語 | 備考 |
| --- | --- | --- |
| agent | エージェント | `coding agent` → コーディングエージェント、`child agent` → 子エージェント |
| subagent | サブエージェント | |
| Console (the product) | Console | OpenCode Console はそのまま。コンソールと訳さない。URL・パス・太字 UI ラベル（**Console API URL**）も英語 |
| workspace | ワークスペース | |
| team | チーム | Go Teams は英語のまま |
| account | アカウント | |
| member | メンバー | |
| role | ロール | |
| invite | 招待 | |
| provider (model provider) | プロバイダー | プロバイダーキー、モデルプロバイダー |
| model | モデル | |
| session | セッション | |
| tool | ツール | |
| skill | スキル | |
| plugin | プラグイン | |
| transform (plugin API) | トランスフォーム | `ctx.worktree.transform` などの API 名は変更しない |
| command | コマンド | スラッシュコマンドも コマンド |
| prompt | プロンプト | |
| token | トークン | 数値の隣でも トークン（`1M トークン`） |
| request | リクエスト | |
| permission / permissions | 権限 | |
| policy / policies | ポリシー | |
| config / configuration | 設定 | `config file` → 設定ファイル、`OpenCode config` → OpenCode の設定 |
| formatter | フォーマッター | |
| theme | テーマ | |
| keybind / keybinding | キーバインド | |
| transcript | トランスクリプト | |
| scrollback | スクロールバック | |
| checkpoint | チェックポイント | |
| effort (reasoning effort) | 推論の強度 | |
| loopback | ループバック | |
| harness | harness | 英語のまま（Claude Code、Codex などの harness） |
| profile (Codex) | profile | 英語のまま |
| bundle | バンドル | |
| invoice | 請求書 | |
| invoiced billing | 請求書払い | |
| credits | クレジット | Console アプリの UI は残高だが、サイト・ドキュメントではクレジット |
| balance | 残高 | |
| credit limit | クレジット上限 | |
| spend limit | 支出上限 | |
| plan | プラン | |
| subscription | サブスクリプション | |
| subscribe / subscriber (paid plan) | 契約する / 契約者 | イベントの subscribe は「購読する」 |
| seat (billing) | メンバー 1 人分の利用枠 | シート・席とは訳さない。seat fee → メンバーごとの利用料 |
| allowance (Go) | 利用枠 | `Go allowance` → Go の利用枠 |
| usage | 使用量 | |
| budget | 予算 | |
| Free (tier) | 無料 | 無料枠は free tier |
| base URL | ベース URL | |
| Diff (viewer / section) | Diff | 単なる差分は 差異 |
| composer | 入力欄 | API オブジェクト名は `composer` のまま |
| references (feature) | 参照 | ページ内の Reference セクションは リファレンス |
| authentication / authenticate | 認証 | 「認証」で統一し、言い換えない |
| proxy (network) | プロキシ | ネットワーク以外の代理は 代理 |
| expose (API / RPC) | 公開する | |
| web search | Web 検索 | |
| reasoning | 推論 | |
| embed (embedding model) | ベクトル化する | モデルの説明では「ベクトル化用のモデル」など。SDK の embed は「組み込む」 |
| context | コンテキスト | |
| compaction | コンパクション | |
| snapshot | スナップショット | |
| revert | 元に戻す | `/undo` `/redo` はコマンドのまま |
| share link | 共有リンク | |
| server | サーバー | |
| desktop app | デスクトップアプリ | |
| web app | Web アプリ | |
| TUI | TUI | |
| terminal | ターミナル | |
| shell | シェル | |
| directory | ディレクトリ | |
| repository | リポジトリ | |
| worktree | ワークツリー | コマンドや API の識別子は変更しない |
| branch | ブランチ | |
| frontmatter | フロントマター | |
| gateway | ゲートウェイ | |
| endpoint | エンドポイント | |
| inference | 推論 | Console の Inference ページ名は 推論 |
| member | メンバー | |
| identity provider | ID プロバイダー | |
| audit log | 監査ログ | |
| service account | サービスアカウント | |
| admin | 管理者 | |
| open source | オープンソース | |
| open weight | オープンウェイト | |
| proprietary | プロプライエタリ | |
| frontier model | フロンティアモデル | |
| benchmark | ベンチマーク | |
| rate limit | レート制限 | |
| failover | フェイルオーバー | |
| fallback | フォールバック | |
| retry | 再試行 | |
| trial | トライアル | |
| best effort | 可能な範囲で、〜できるとは限らない | 制約や保証の有無が伝わる表現にする |
| resolve | 特定する、決定する、解決する | モデルや設定値なら「特定」「決定」、相対パスなら「〜を基準に解決」 |
| eviction / unload (in-memory state) | メモリから解放する | アイドル状態の Location やサービスを破棄する場合 |
| stage / commit a rollback | ロールバックを仮適用する／確定する | Git の「ステージ」「コミット」と区別する |

## 判断に迷ったとき

- 「エージェント」と「AI」を組み合わせない。OpenCode は「オープンソースのコーディングエージェント」。
- 英語の名詞列（`budgets, policies, and SSO`）は「予算、ポリシー、SSO」のように読点でつなぐ。
- 受動態の直訳を避け、主語を補うか能動態にする（`Errors are shown` → エラーが表示されます）。
- 英語の比喩や口語（`out of the box`、`under the hood`）は日本語の技術文書の言い方（「そのまま」「内部で」）にする。
