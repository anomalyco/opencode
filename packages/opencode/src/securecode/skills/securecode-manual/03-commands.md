# 03. コマンドリファレンス

SecureCode の CLI はあえて最小構成にしてあります。サブコマンドはなく、`securecode` を起動すれば対話モード (TUI) が立ち上がるだけです。`securecode --help` でも同じことが確認できます。

## `securecode` (TUI)

引数なしで起動すると対話モード (TUI) が立ち上がります。基本かつ唯一の使い方。

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

## ヘルプを引く

```bash
securecode --help
```

`/help` は **TUI 内** のスラッシュコマンド版で、起動中の対話モードでだけ使えます。

## なぜサブコマンドがないのか

SecureCode は `anomalyco/opencode` の fork ですが、社内運用で実際に必要だった subcommand は TUI 起動だけだったので、それ以外 (`run` / `serve` / `attach` / `mcp` / `providers` / `auth` / `agent` / `models` / `stats` / `session` / `export` / `import` / `plugin` / `db` / `debug` 等) は CLI から外しています。

認証は subcommand 経由ではなく、環境変数 (`SECURECODE_QWEN3_API_KEY` など) で渡す設計です。詳細は `01-installation.md` と `04-config.md` を参照。

## 関連

- 認証と環境変数 → `01-installation.md`
- 設定ファイルの中身 → `04-config.md`
- 起動でつまずいたら → `06-troubleshooting.md`
