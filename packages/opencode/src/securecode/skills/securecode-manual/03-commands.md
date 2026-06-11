# 03. コマンドリファレンス

SecureCode の CLI はあえて最小構成にしてあります。日常的に使うのは TUI 起動 (引数なし) と `run` の 2 つだけです。`securecode --help` でも同じ 2 つが見えます。

## `securecode` (TUI default)

引数なしで起動すると対話モード (TUI) が立ち上がります。これが基本の使い方。

```bash
# 対話モード (TUI) を起動
securecode

# 特定のプロジェクトディレクトリを指定して起動
securecode /path/to/project
```

主なフラグ:

- `--print-logs`: ログを画面に流す (デバッグ時)
- `--log-level <level>`: ログの詳しさ (`DEBUG` / `INFO` / `WARN` / `ERROR`)
- `--pure`: 外部 plugin を読まない (社内配布の内蔵 plugin は動く)
- `--model <provider>/<model>`: 単発でモデル指定
- `--continue`: 直前のセッションを継続
- `--session <id>`: 指定 ID のセッションを継続
- `--prompt <text>`: 起動時に渡す初期プロンプト
- `--agent <name>`: 使うエージェントを指定

## `securecode run [message..]`

CI やスクリプトから 1 回だけプロンプトを投げて結果を受け取りたいときに使います。

```bash
# プロンプトを 1 回だけ投げて終了
securecode run "テストを書いて"

# モデルを指定して 1 回実行
securecode run --model qwen/qwen3-coder "コードレビューして"

# JSON 形式で機械可読出力
securecode run --format json "依存関係を整理して"

# 既に動いている server に接続して実行
securecode run --attach http://localhost:4096 "状況を教えて"
```

主なフラグ:

- `--model <provider>/<model>`: モデル指定
- `--agent <name>`: エージェント指定
- `--format json`: 機械可読出力
- `--continue` / `--session <id>`: セッション継続
- `--attach <url>`: 動いている server に接続して実行
- `-f <file>`: ファイルを添付

## ヘルプを引く

```bash
securecode --help
securecode run --help
```

`/help` は **TUI 内** のスラッシュコマンド版で、起動中の対話モードでだけ使えます。

## なぜサブコマンドが少ないのか

SecureCode は `anomalyco/opencode` の fork ですが、社内運用で実際に必要だった subcommand は TUI default と `run` の 2 つだけだったので、それ以外 (`serve` / `attach` / `mcp` / `providers` / `auth` / `agent` / `models` / `stats` / `session` / `export` / `import` / `plugin` / `db` / `debug` 等) は CLI から外しています。

認証は subcommand 経由ではなく、環境変数 (`SECURECODE_QWEN3_API_KEY` など) で渡す設計です。詳細は `01-installation.md` と `04-config.md` を参照。

## 関連

- 認証と環境変数 → `01-installation.md`
- 設定ファイルの中身 → `04-config.md`
- 各コマンドが落ちるときの対処 → `06-troubleshooting.md`
