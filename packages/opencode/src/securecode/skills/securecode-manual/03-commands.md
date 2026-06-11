# 03. コマンドリファレンス

`securecode --help` を打つとサブコマンド一覧が出ます。ここではよく使うものに絞って整理します。

## いちばん使うもの

### `securecode` / `securecode run`

引数なしまたは `run` で起動。最頻出。

```bash
# 対話モード (TUI) で起動
securecode

# プロンプトを 1 回だけ投げて終了 (CI 向け)
securecode run "テストを書いて"

# 既に動いている server に TUI で接続
securecode run --interactive --attach <url>
```

主なフラグ:
- `--print-logs`: ログを画面に流す（デバッグ時）
- `--log-level <level>`: ログの詳しさ (`debug` / `info` / `warn` / `error`)
- `--pure`: 外部 plugin を読まない（社内配布の内蔵 plugin は動く）
- `--model <provider>/<model>`: 単発でモデル指定

### `securecode models`

利用可能モデルを表示。複数 provider 設定時は切り替え候補を確認できます。

```bash
securecode models
```

### `securecode providers`

プロバイダ一覧と認証状態を表示。

### `securecode session`

過去のセッションを一覧・参照・削除。

```bash
securecode session list
securecode session show <id>
```

## サーバ系

### `securecode serve`

エンジンだけを HTTP server として起動。画面なし。複数クライアントから接続する構成や、デバッグ目的で使います。

### TUI で外部 server に接続

```bash
securecode run --interactive --attach http://localhost:4096
```

## エージェント / プラグイン

### `securecode agent`

エージェント定義の確認。`primary` / `subagent` の一覧、permission 設定の dump など。

### `securecode plug`

plugin の状態確認。`--pure` 起動の挙動と組み合わせてデバッグに使う。

### `securecode mcp`

MCP (Model Context Protocol) サーバの管理。外部ツール連携を MCP 経由で接続する場合に使う。

## メンテナンス

### `securecode upgrade`

最新リリースに更新。`gh` 認証が通っていれば private repo から取得します。

### `securecode uninstall`

バイナリと `~/.config/securecode/` を確認しながら削除。

### `securecode stats`

利用統計の表示（トークン使用量・コスト推定など）。

### `securecode db`

内部の SQLite データベース管理（履歴・KV）。通常は触らなくて良い。`db vacuum` 等のメンテ用。

### `securecode debug`

各種デバッグサブコマンド（skill 一覧・tool 一覧・各種 dump）。`securecode debug skill list` で読み込まれているスキルを確認できます。

## ヘルプを引く

困ったらまず:

```bash
securecode --help
securecode <subcommand> --help
```

`/help` は **TUI 内** のスラッシュコマンド版で、起動中の対話モードでだけ使えます。

## 関連

- 設定ファイルの中身 → `04-config.md`
- 各コマンドが落ちるときの対処 → `06-troubleshooting.md`
