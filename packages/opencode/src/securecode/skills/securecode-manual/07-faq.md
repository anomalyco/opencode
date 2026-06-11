# 07. FAQ

よくある質問と、簡潔な答え。

## データの扱い

### Q. 私のソースコードはどこに送られる？

A. セキュアコード は Acompany が運用する **Confidential Computing 環境上の LLM endpoint**（既定では `conf-ai.acompany-az.com`）にのみコードを送ります。endpoint は TEE (Trusted Execution Environment) 上で動作し、インフラ事業者やモデル提供者からも処理中データが見えない設計です。

### Q. 第三者の LLM provider（OpenAI / Anthropic 等）に送られることはある？

A. 既定構成ではありません。`securecode.json` を編集して別 provider を増やせばその provider へは送られますが、サンドボックスがそのドメインを許可していなければ送信は遮断されます。

### Q. 会話履歴はどこに保存される？

A. ローカルの SQLite データベース（`~/.local/share/securecode/` 配下）に保存されます。クラウド同期はしません。TUI 内のスラッシュコマンドや keybind でセッションの一覧・切替・削除ができます。

### Q. 監査ログは？

A. AI の利用ログ（誰がいつどのコードベースで AI を使ったか）は記録され、可視化に対応しています。詳細な参照方法は Acompany 担当者にお問い合わせください。

## 機能

### Q. オフラインで使える？

A. 使えません。LLM 推論は Acompany endpoint を呼ぶ必要があるためネットワーク必須です。

### Q. MCP に対応している？

A. 対応しています。`securecode.json` の `mcp` セクションに MCP サーバを直接定義してください (詳細は `04-config.md`)。MCP サーバが外部通信する場合は、サンドボックスでそのドメインを許可する必要があります。

## 制約

### Q. なぜ通信が制限されている？

A. 機密ソースコードを扱う前提のため、AI の出力先や tool が呼ぶ外部 API を明示的に許可制にしています。これにより、prompt injection で「外部に送れ」と仕込まれても遮断できます。詳細は `05-sandbox.md`。

### Q. Windows ネイティブ環境では動く？

A. Windows ネイティブバイナリは配布していません。WSL2 上で Linux 版を使ってください。

### Q. Docker コンテナ内で動かしたい

A. 多重サンドボックスは原則非対応です。コンテナ内では特権モードが必要になり、本来の保護目的と矛盾します。ホスト側で起動するのを推奨します。

## 運用

### Q. アップデートはどうやる？

A. 初回 install と同じスクリプトを再実行してください (`gh release download -R acompany-develop/securecode --pattern install -O - | bash`)。`gh` 認証が必要です。詳しくは `06-troubleshooting.md` の「最新版に更新したい」。

### Q. 設定をチームで共有したい

A. `~/.config/securecode/securecode.json` をテンプレ化して配布するのが現実的です。API キーは **必ず環境変数経由**（`{env:SECURECODE_QWEN3_API_KEY}`）にして、ファイル本体をコミット可能な状態に保ってください。

### Q. 問い合わせ先

A. Acompany の担当者まで。バグや要望は社内チャンネルへ。

## 関連

- 何かが動かないとき → `06-troubleshooting.md`
- インストール / 初回設定 → `01-installation.md` / `02-quickstart.md`
