# format-claude-stream（ベンダリング）

[Khan/format-claude-stream](https://github.com/Khan/format-claude-stream) を
このリポジトリにベンダリング（vendoring = 外部コードを取り込んで同梱）したもの。
`claude --output-format stream-json` の出力を人間が読みやすいテキストへ整形する CLI フィルタで、
securecode では `anthropics/claude-code-action` の実行ログを GitHub Actions の
Job Summary に整形表示するために使う。

## 出所

- upstream: https://github.com/Khan/format-claude-stream
- 取り込んだコミット: `d0cf4bfb871a1e483f6164b869cb276340e09af6`
- ライセンス: MIT（`LICENSE` を同梱。Copyright Khan Academy）

`src/` 配下は upstream のソースをそのまま取り込んでいる（テスト・テストケース・
テスト用フェイク、および後述の理由で yargs に依存する `src/cli/` は除外）。整形ロジックは無改変。

## securecode での改変・追加

upstream をできるだけ無改変で保ちつつ、最小限の追加だけで使えるようにしている。

1. **`render-execution-file.ts`（追加）** — securecode 固有のエントリポイント。
   upstream の CLI (`src/cli/main.ts`) は「1 行 = 1 JSON」の JSONL を stdin から読む前提だが、
   `claude-code-action` の `execution_file` 出力は `JSON.stringify(messages, null, 2)` による
   **JSON 配列**（`base-action/src/execution-file.ts` 参照）。形式が違うため、配列として読み込み
   各要素（= stream-json イベントと同形）を 1 件ずつ formatter に渡すラッパを追加した。

2. **依存を zod だけに絞った** — `package.json` の `dependencies` は `zod` のみ。
   理由は CI で `bun install` 時に npm から取得するパッケージ数（＝サプライチェーンの攻撃面）を
   最小化するため。upstream が使う他 2 つの依存は次のように扱う:
   - `chalk`（カラー出力）… `render-execution-file.ts --color` 指定時のみ **動的 import**。
     既定の依存に含めないので、入っていなければ自動でプレーン出力へフォールバックする。
     `src/adapters/chalk-colorizer.ts` と、それを re-export する `src/index.ts` は残しているが、
     既定の整形パス（プレーン）からは読み込まれない。
   - `yargs`（引数解析）… 使わない。yargs に依存していた upstream の JSONL 用 CLI
     (`src/cli/`) は、`execution_file` が JSON 配列で形式が合わず使い道がないため取り込み時に除外した。

## セキュリティ上の前提

- `render-execution-file.ts` は execution_file を **データとして** `JSON.parse` → zod 検証 →
  文字列整形 → 出力するだけ。中身を見て `install` / `import` / `eval` する経路は一切ない。
  したがって execution_file に悪意ある文字列が含まれても、それが取り込まれて実行されることはない。
- LLM 呼び出しを含まないため、このスクリプト自体は prompt injection の対象にならない。
- CI では `bun.lock`（整合性ハッシュ付き）をコミットし、`--frozen-lockfile --ignore-scripts` で
  バージョン固定・スクリプト無効化して install する（bun は依存のライフサイクルスクリプトを
  そもそも実行しない）。

## ローカルでの動作確認

```bash
cd .github/format-claude-stream
bun install --frozen-lockfile
bun render-execution-file.ts <execution_file.json>          # プレーン（Job Summary 向け）
bun render-execution-file.ts <execution_file.json> --color  # ANSI カラー（要 chalk）
```

## upstream への追従

整形ロジックを更新したいときは、upstream の `src/` を再取得して上書きし、本 README の
「取り込んだコミット」を更新する。`render-execution-file.ts` と `package.json` は securecode 固有なので
原則そのまま維持する。
