# 07. FAQ

よくある質問と、簡潔な答え。

## データの扱い

### Q. 私のソースコードはどこに送られる？

A. SecureCode は Acompany が運用する **Confidential Computing 環境上の LLM endpoint**（既定では `conf-ai.acompany-az.com`）にのみコードを送ります。endpoint は TEE (Trusted Execution Environment) 上で動作し、インフラ事業者やモデル提供者からも処理中データが見えない設計です。

### Q. 第三者の LLM provider（OpenAI / Anthropic 等）に送られることはある？

A. 既定構成ではありません。`securecode.json` を編集して別 provider を増やせばその provider へは送られますが、サンドボックスがそのドメインを許可していなければ送信は遮断されます。

### Q. 会話履歴はどこに保存される？

A. ローカルの SQLite データベース（`~/.local/share/securecode/` 配下）に保存されます。クラウド同期はしません。`securecode session list` で確認、`securecode db` でメンテ可能です。

### Q. 監査ログは？

A. AI の利用ログ（誰がいつどのコードベースで AI を使ったか）は記録され、可視化に対応しています。詳細な参照方法は Acompany 担当者にお問い合わせください。

## 機能

### Q. オフラインで使える？

A. 使えません。LLM 推論は Acompany endpoint を呼ぶ必要があるためネットワーク必須です。

### Q. どのモデルが使える？

A. 既定は `Qwen3.6-35B-A3B-FP8`。他にも GPT-OSS、Qwen3.5、Qwen3-Coder-Next 等のオープンウェイト LLM が利用可能です。利用可能モデルは `securecode models` で確認できます。

### Q. MCP に対応している？

A. 対応しています。`securecode mcp` サブコマンドで MCP サーバを登録できます。ただし MCP サーバが外部通信する場合は、サンドボックスでそのドメインを許可する必要があります。

### Q. plugin を追加できる？

A. opencode の plugin 機構をそのまま利用できます。`packages/opencode/src/plugin/` 配下に server-side plugin、`tui-plugins/` 配下に TUI plugin を置く形です。社内独自 plugin の作り方は `docs/03-hooks.md` を参照してください。

## 制約

### Q. なぜ通信が制限されている？

A. 機密ソースコードを扱う前提のため、AI の出力先や tool が呼ぶ外部 API を明示的に許可制にしています。これにより、prompt injection で「外部に送れ」と仕込まれても遮断できます。詳細は `05-sandbox.md`。

### Q. Windows ネイティブ環境では動く？

A. バイナリは配布されますが、サンドボックス機構は WSL2 推奨です。Windows ネイティブで起動する場合の保護レベルは限定的になります。

### Q. Docker コンテナ内で動かしたい

A. 多重サンドボックスは原則非対応です。コンテナ内では特権モードが必要になり、本来の保護目的と矛盾します。ホスト側で起動するのを推奨します。

## 運用

### Q. アップデートはどうやる？

A. `securecode upgrade` で最新リリースに更新します。`gh` 認証が必要です。詳しくは `03-commands.md`。

### Q. 設定をチームで共有したい

A. `~/.config/securecode/securecode.json` をテンプレ化して配布するのが現実的です。API キーは **必ず環境変数経由**（`{env:SECURECODE_QWEN3_API_KEY}`）にして、ファイル本体をコミット可能な状態に保ってください。

### Q. 問い合わせ先

A. Acompany の担当者まで。バグや要望は社内チャンネルへ。

## 関連

- 何かが動かないとき → `06-troubleshooting.md`
- インストール / 初回設定 → `01-installation.md` / `02-quickstart.md`
