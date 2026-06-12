# opencode-trade Agent Rules

## 言語

常に日本語で応答する。

## 現在の作業分担

- `opencode` は主開発、実装量の多い変更、CI 修正、進行中 PR を担当する。
- `codex` は README、開発フロー文書、設計メモ、branch hygiene、限定監査を担当する。
- この分担は現フェーズの運用指針であり、恒久的なアーキテクチャ境界ではない。

## ハード境界

- F001: Plan モード中のコード、設定、文書への書き込みは禁止。
- Plan モードは調査、設計、レビュー、実装計画の提示に限定する。
- 実装はユーザーが実行を明示した後、作業ブランチまたは PR 経由で行う。
- 保護ブランチ、ライブ環境、未レビュー状態への直接反映は禁止。
- Bun / TypeScript の tests と typecheck を repo root から実行しない。
- MT5 order execution、risk gate、live trading readiness は Class D 扱いとし、低コストモデルの最終判断にしない。
- MQL5 behavior 変更は parser test だけで完了扱いにしない。必要な compile / smoke / evidence を確認する。

## 権威マップ

- モデルと provider の実行設定: `.opencode/opencode.jsonc`
- 作業手順: `DEVELOPMENT.md`
- trading plan と risk gate: `EA_TRADING_PLAN.md`
- 哲学と HARD_TASK 境界: `SOUL.md`
- branch 運用: `docs/github-branch-workflow.md`
- opencode core / SessionV2: `specs/v2/session.md`, `specs/v2/schema-changelog.md`

## コミット

コミットと PR title は `type(scope): summary` を使う。
有効な type は `feat`, `fix`, `docs`, `chore`, `refactor`, `test`。
