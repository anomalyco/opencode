# OpenCode 開発ガイド

## ビルド

```bash
cd /Users/ikedatomoya/Documents/work/opencode/packages/opencode
bun run build
```

ビルド結果は `dist/` ディレクトリに出力される：

```
dist/
├── opencode-darwin-arm64/    # macOS Apple Silicon
│   └── bin/opencode
├── opencode-darwin-x64/      # macOS Intel
├── opencode-linux-arm64/     # Linux ARM
├── opencode-linux-x64/       # Linux x64
└── opencode-windows-x64/     # Windows
```

## インストール（開発版）

### macOS Apple Silicon の場合

ビルド後、開発版バイナリを `~/.local/bin/` にコピー：

```bash
# コピー元: dist/opencode-darwin-arm64/bin/opencode
# コピー先: ~/.local/bin/opencode
cp dist/opencode-darwin-arm64/bin/opencode ~/.local/bin/opencode
```

### macOS Intel の場合

```bash
cp dist/opencode-darwin-x64/bin/opencode ~/.local/bin/opencode
```

### ビルド＆インストール（ワンライナー）

```bash
cd /Users/ikedatomoya/Documents/work/opencode/packages/opencode && \
bun run build && \
cp dist/opencode-darwin-arm64/bin/opencode ~/.local/bin/opencode
```

## 起動

### 開発版（インストール済み）

```bash
~/.local/bin/opencode
```

### 開発モード（ソースから直接実行）

```bash
cd /Users/ikedatomoya/Documents/work/opencode/packages/opencode
bun run dev
```

---

## デバッグ

### ログファイルの場所

OpenCodeのログは以下に出力される：

| 種類 | パス |
|------|------|
| メインログ | `~/Library/Application Support/opencode/log/YYYY-MM-DDTHHMMSS.log` |
| 開発モードログ | `~/Library/Application Support/opencode/log/dev.log` |
| Kiroデバッグログ | `/tmp/kiro-debug.log` |

### ログ確認コマンド

```bash
# 最新のログファイルを確認
ls -lt ~/Library/Application\ Support/opencode/log/ | head -5

# 最新のログファイルをリアルタイム監視
tail -f "$(ls -t ~/Library/Application\ Support/opencode/log/*.log | head -1)"

# 開発モードのログを監視
tail -f ~/Library/Application\ Support/opencode/log/dev.log

# エラーのみをフィルタ
grep -i error "$(ls -t ~/Library/Application\ Support/opencode/log/*.log | head -1)"

# 特定のagent（build, title等）のログをフィルタ
grep "agent=build" "$(ls -t ~/Library/Application\ Support/opencode/log/*.log | head -1)"
```

### ログのフォーマット

```
INFO  2026-01-17T09:14:32 +123ms service=session agent=build stream
ERROR 2026-01-17T09:14:35 +3000ms service=session agent=build error=...
```

| フィールド | 説明 |
|-----------|------|
| `INFO/ERROR/WARN/DEBUG` | ログレベル |
| `2026-01-17T09:14:32` | タイムスタンプ |
| `+123ms` | 前のログからの経過時間 |
| `service=xxx` | サービス名 |
| `agent=xxx` | エージェント名（build, title等） |

### Kiroプロバイダーのデバッグ

Kiro専用のデバッグログは `/tmp/kiro-debug.log` に出力される：

```bash
# リアルタイム監視
tail -f /tmp/kiro-debug.log

# ログをクリアして新しく開始
echo "" > /tmp/kiro-debug.log && tail -f /tmp/kiro-debug.log
```

#### Kiroデバッグログの内容

```
[2026-01-17T09:14:32.123Z] URL: https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse
Prompt structure: [0] role=system, [1] role=user, [2] role=assistant, [3] role=user
Payload: {
  "conversationState": {
    "chatTriggerType": "MANUAL",
    "conversationId": "...",
    "currentMessage": {...},
    "history": [...]
  }
}
```

| 項目 | 説明 |
|------|------|
| URL | APIエンドポイント |
| Prompt structure | AI SDKから渡されたメッセージのrole一覧 |
| Payload | Kiro APIに送信される実際のリクエスト |

### よくある問題

#### 400 Bad Request（Kiro）

**原因**: Kiro APIはuser/assistantの交互配置を要求する

**確認方法**:
```bash
grep "Prompt structure" /tmp/kiro-debug.log
```

**問題のあるパターン**:
```
Prompt structure: [0] role=system, [1] role=user, [2] role=assistant, [3] role=assistant
```
連続したassistant（index 2と3）がある場合、`converters.ts`のマージ処理が正しく動作していない。

**修正箇所**: `src/provider/sdk/kiro/src/converters.ts`

#### 認証エラー（Kiro）

```bash
# Kiro CLIで再認証
kiro login

# 認証情報の確認
ls -la ~/Library/Application\ Support/kiro-cli/data.sqlite3

# 認証情報の中身を確認（SQLite）
sqlite3 ~/Library/Application\ Support/kiro-cli/data.sqlite3 ".tables"
```

#### ストリーミングエラー（Kiro）

AWS Event Streamのパースエラーの場合、`streaming.ts`を確認：

```bash
# レスポンスの生データを確認するには、kiro-language-model.tsにログを追加
```

---

## Kiroプロバイダー

Kiro（AWS）のサブスクリプションを使ってOpenCodeを利用可能。

### 前提条件

1. Kiro CLIがインストールされていること
2. `kiro login` で認証済みであること

認証情報は `~/Library/Application Support/kiro-cli/data.sqlite3` に保存される。

### 実装構成

```
src/provider/sdk/kiro/src/
├── index.ts              # export { createKiro }
├── kiro-provider.ts      # createKiro() ファクトリ
├── kiro-language-model.ts # LanguageModelV2 実装（デバッグログ出力）
├── converters.ts         # AI SDK → Kiro 形式変換（メッセージマージ処理）
├── streaming.ts          # AWS Event Stream パース
└── model-resolver.ts     # モデルID正規化
```

### 利用可能なモデル

- `claude-sonnet-4-5` (Claude Sonnet 4.5)
- `claude-opus-4-5` (Claude Opus 4.5)
- `claude-haiku-4-5` (Claude Haiku 4.5)
- `claude-sonnet-4` (Claude Sonnet 4)
- `claude-3-7-sonnet` (Claude 3.7 Sonnet)

### テスト方法

```bash
# 1. ビルド＆インストール
cd /Users/ikedatomoya/Documents/work/opencode/packages/opencode
bun run build
cp dist/opencode-darwin-arm64/bin/opencode ~/.local/bin/opencode

# 2. デバッグログをクリア
echo "" > /tmp/kiro-debug.log

# 3. OpenCodeを起動してKiroモデルを選択
~/.local/bin/opencode

# 4. 別ターミナルでログを監視
tail -f /tmp/kiro-debug.log
```

### リファレンス

実装の参考: `reference/kiro-gateway/kiro/` (kiro-gateway プロジェクト)

---

## ディレクトリ構成

```
~/Library/Application Support/opencode/    # XDG_DATA_HOME/opencode
├── log/                                   # ログファイル
│   ├── dev.log                           # 開発モードログ
│   └── 2026-01-17T091432.log             # 通常ログ（タイムスタンプ）
└── bin/                                   # ダウンロードしたバイナリ

~/Library/Caches/opencode/                 # XDG_CACHE_HOME/opencode
└── ...                                    # キャッシュファイル

~/.config/opencode/                        # XDG_CONFIG_HOME/opencode
└── ...                                    # 設定ファイル
```
