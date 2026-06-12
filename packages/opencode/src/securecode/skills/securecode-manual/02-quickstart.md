# 02. クイックスタート

インストール直後から、最初の AI 応答を受け取るまでの最短ルート。

## 1. API キーを環境変数に入れる

Acompany から発行された Qwen3.6 API キーを `SECURECODE_QWEN3_API_KEY` として設定します。

```bash
# 一時的に試すだけ
export SECURECODE_QWEN3_API_KEY="<your-key>"

# 永続化したい場合は ~/.zshrc / ~/.bashrc に追記
echo 'export SECURECODE_QWEN3_API_KEY="<your-key>"' >> ~/.zshrc
source ~/.zshrc
```

> キーをファイルに保存する場合は **必ず gitignore された場所** にしてください。`securecode.json` 内へ直書きしない（コミット事故の原因）。設定ファイルは `{env:SECURECODE_QWEN3_API_KEY}` で環境変数を参照する形になっています。

## 2. 起動する

引数なしで `securecode` を実行すると対話モード (TUI) が立ち上がります。

```bash
cd /path/to/your/repo
securecode
```

TUI（vim 風のターミナル画面）が立ち上がり、最下部の入力欄にプロンプトを打って Enter で送信します。最初の応答が返ってくれば API キー / ネットワークの導通も OK。

主な TUI 操作:
- `Ctrl-C` を 2 回 / `Ctrl-D`: 終了
- `Esc`: 入力中の取り消し
- `/help`: スラッシュコマンド一覧
- `/models`: モデルを切り替え（複数モデルを設定している場合）
- `/themes`: テーマを切り替え（`tui.json` と kv.json に保存される）

## 3. ワーキングディレクトリ

セキュアコード は **起動時の CWD** をプロジェクトルートとして認識します。AI のファイル操作はそのディレクトリ配下に制限されます。

複数リポジトリで使う場合は、リポジトリのルートで `cd` してから `securecode` を起動するのが基本です。

## 4. よくある初回エラー

| 症状 | だいたいの原因 | 対処 |
|---|---|---|
| `SECURECODE_QWEN3_API_KEY` is not set | API キー未設定 | `export` で設定 |
| 401 / Unauthorized | キーが無効 / typo | Acompany 担当者にキー再発行を依頼 |
| 接続できない / blocked | サンドボックスが社内 proxy を遮断 | `05-sandbox.md` 参照 |
| sandbox failed to start | macOS Seatbelt / Linux bubblewrap が動かない環境 | `06-troubleshooting.md` 参照 |

## 関連

- コマンドの全体像 → `03-commands.md`
- モデルの切り替え → `04-config.md`
- 通信が遮断される問題 → `05-sandbox.md`
