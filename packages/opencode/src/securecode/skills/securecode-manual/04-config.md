# 04. 設定ファイル

セキュアコード の設定は `~/.config/securecode/` 配下にまとまっています（`XDG_CONFIG_HOME` を設定している場合はそちら）。

## 場所と役割

```
~/.config/securecode/
  securecode.json    # provider / モデル / 認証
  tui.json           # TUI 表示設定 (テーマ等)
  sandbox.json       # サンドボックスの許可ドメイン (任意・存在すれば優先)
  themes/            # ユーザー追加テーマ
  skills/            # スキル定義 (このマニュアルもここ)

<起動した cwd>/.securecode/
  sandbox.json       # プロジェクト固有の追加許可 (任意)
```

`sandbox.json` は **global (`~/.config/securecode/sandbox.json`) と project (`./.securecode/sandbox.json`) を両方読み、union で合成** します。詳しくは `05-sandbox.md` の「per-directory 設定」を参照。

`~/.local/state/securecode/kv.json` には起動時の状態（初期テーマ等）が入ります。`/themes` で切り替えた値もここに保存され、次回起動で読まれます。

## `securecode.json`

provider と model を定義します。初期テンプレ:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "qwen": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Acompany NCC Qwen3.6-35B-A3B-FP8",
      "options": {
        "baseURL": "https://conf-ai.acompany-az.com/v1",
        "apiKey": "{env:SECURECODE_QWEN3_API_KEY}"
      },
      "models": {
        "qwen3.6-35b-a3b-fp8": {
          "name": "Qwen3.6-35B-A3B-FP8",
          "limit": { "context": 262144, "output": 16384 },
          "options": { "chat_template_kwargs": { "enable_thinking": false } }
        }
      }
    }
  },
  "model": "qwen/qwen3.6-35b-a3b-fp8",
  "small_model": "qwen/qwen3.6-35b-a3b-fp8"
}
```

ポイント:

- `apiKey` は **環境変数を `{env:VAR}` 構文で参照** する。直書きしない（コミット事故の原因）
- `model` / `small_model` は `<provider>/<model>` 形式
- 追加 provider を増やしたい場合は `provider` の下に並べる（複数 OK）

## `tui.json`

TUI の表示まわり。`setup/tui.json.example` がそのままテンプレ。テーマや余白・色味のチューニング用。

`/themes` コマンドで切り替えた値は `kv.json` に保存され、`tui.json` より優先されます。

## `sandbox.json`

サンドボックスの許可ドメインや追加マウントを書く **任意ファイル**。デフォルトでは Acompany endpoint (`conf-ai.acompany-az.com`) のみ通り、それ以外への HTTPS / SOCKS5 outbound は遮断されます。

置き場所は 2 階層:

- **Global**: `~/.config/securecode/sandbox.json` — 全プロジェクト共通の許可
- **Project**: 起動 cwd 直下の `./.securecode/sandbox.json` — そのプロジェクト固有の追加許可

両方存在する場合は **allow / deny を union (重複除去)** で合成します。allow は global ∪ project、deny も global ∪ project。どこかで deny されていれば sandbox-runtime 側で deny が勝ちます。

`sandbox.json` の編集後は **securecode を再起動** してください（実行中は読まれません）。

> これらのファイル自体は **AI からは読みも書きも一切できません**。global / project どちらの `sandbox.json` も OS サンドボックスの `denyRead` + `denyWrite` に常時固定されているため、AI に「中身を見せて」「書き換えて」「消して作り直して」と頼んでも、OS (Seatbelt / bubblewrap) が物理的にブロックします。AI が自分の檻を広げる方向の改ざんは構造上不可能です。詳細は `05-sandbox.md`。

## 設定の優先順位

同じキーが複数の場所で定義された場合、概ね次の優先で merge されます（強い方が上）。

1. CLI フラグ (`--model` 等)
2. 環境変数 (`SECURECODE_*`)
3. プロジェクト直下の `securecode.json`（あれば）
4. `~/.config/securecode/securecode.json`
5. ビルトイン既定値

## 関連

- 認証エラーの切り分け → `06-troubleshooting.md`
- サンドボックスのドメイン許可 → `05-sandbox.md`
