# EA Lab Memory Foundations

## 概要

EA Lab Memory System - Phase 1: Memory Foundations は、MT5 EA 開発を「会話の記憶」ではなく「検証済み証跡」に基づいて進めるための repo-local memory layer です。

OpenCode core は変更せず、`.opencode/ea-lab-core` と `.opencode/mcp/ea-lab-*` に EA Lab 専用の記憶、検索、risk gate check を追加します。

## 目的

- backtest、log、URL、commit、message を evidence として保存する
- 実験仮説、条件、metrics、stage、結果を experiment ledger として残す
- 成功、失敗、near miss、rejection を experience memory として再利用する
- 似た過去事例を SQLite FTS で deterministic に検索する
- `risk/gates.yaml` を正として promotion / live-risk 判断を hard block する
- secret-like text を searchable memory に入れる前に redaction する

## 既存 trade-memory との関係

既存の `trade-memory` は、会話履歴、handoff、active notes、pinned notes、model switch などの作業文脈を扱います。

EA Lab Memory は別レイヤーです。会話ログ全体を信用済み記憶として扱わず、evidence、experiment、experience、risk gate という構造化 record に変換された情報だけを判断材料にします。

現在は「完全統合済み」ではなく「統合できる土台を横付けした」段階です。ただし、当初の Phase 1 から一歩進み、EA Lab service の一部 safety hardening は実装済みです。

## 現在の実装状態

Phase 1 の基盤に加えて、現在は以下が入っています。

- `ea-lab-service.ts` の mutating path で promotion / live stage 遷移を fail-closed で gate check
- `result_status: promoted` と `stage: micro_live / limited_live` を危険遷移として扱う service-level enforcement
- evidence locator、searchable text、JSON payload に対する secret-like redaction の強化
- EA Lab HTTP health endpoint の local bind / token guard

この hardening は OpenCode core ではなく、repo-local な `.opencode/ea-lab-core` / `.opencode/mcp/ea-lab-*` で行っています。

## Phase 1 で追加されるもの

- `.opencode/ea-lab-core/db.ts`: EA Lab SQLite database を開く
- `.opencode/ea-lab-core/schema.ts`: schema 作成、FTS table、trigger、meta version
- `.opencode/ea-lab-core/redaction.ts`: token、secret、password、account login、query param、JSON key-aware redaction
- `.opencode/ea-lab-core/evidence.ts`: evidence 保存と FTS search
- `.opencode/ea-lab-core/experiments.ts`: experiment 保存と result update
- `.opencode/ea-lab-core/experiences.ts`: experience 保存、evidence link、similar search
- `.opencode/ea-lab-core/risk-gates.ts`: `risk/gates.yaml` parse と hard gate check
- `.opencode/mcp/ea-lab-service.ts`: core modules を束ねる service facade
- `.opencode/mcp/ea-lab-http.ts`: local-only / token-guarded HTTP health wrapper
- `.opencode/mcp/ea-lab-server.ts`: MCP / HTTP entrypoint
- `risk/gates.yaml`: 初期 conservative risk policy
- `packages/opencode/test/tool/ea-lab-*.test.ts`: targeted tests for Phase 1 + safety hardening

## Database

default database は repo-local の `memory/sqlite/ea-lab.sqlite3` を想定します。

Phase 1 schema は以下を含みます。

- `ea_lab_meta`
- `raw_event`
- `evidence` / `evidence_fts`
- `experiment`
- `experience` / `experience_fts`
- `experience_evidence`
- `risk_gate_check`
- `promotion_decision`
- `handoff_log`

## Risk Gate Policy

`risk/gates.yaml` は EA Lab Memory の risk policy source of truth です。

初期 policy は conservative に設定しています。

- AI は live trading を有効化できない
- live trading には human approval が必要
- minimum trade count を満たさない promotion を block
- max drawdown limit を超える candidate を block
- out-of-sample evidence なしの promotion を block
- spread sensitivity evidence なしの promotion を block

この policy は AI が勝手に緩和してはいけません。緩和が必要な場合は人間の明示判断と review evidence が必要です。

現在の実装では、`ea_lab_check_risk_gates` という advisory tool だけでなく、`ea-lab-service.ts` の experiment 作成 / 更新経路でも promotion / live 遷移時に gate を強制します。

## 現在もまだ行わないこと

- live trading の有効化
- lot size の自動増加
- risk gate の自動緩和
- MT5 order execution
- MT5 report parser 連携
- Context7 integration
- wiki writer automation
- model-switch bridge
- 全 OpenCode session への automatic handoff injection

加えて、以下も未実装です。

- human-approved live override path
- evidence IDs 由来の自動 gate 判定
- `risk_gate_check` / `promotion_decision` への永続監査ログ連携

## Validation

targeted tests は `packages/opencode` から実行します。

```bash
bun test test/tool/ea-lab-schema.test.ts
bun test test/tool/ea-lab-redaction.test.ts
bun test test/tool/ea-lab-evidence.test.ts
bun test test/tool/ea-lab-experiences.test.ts
bun test test/tool/ea-lab-experiments.test.ts
bun test test/tool/ea-lab-risk-gates.test.ts
bun test test/tool/ea-lab-service.test.ts
bun typecheck
```

PR #2 では targeted tests と local typecheck は通過済みです。その後の EA Lab hardening でも、EA Lab targeted tests と local `bun typecheck` を継続して gate に使います。PR 上の `test` workflow は EA Lab targeted tests と MT5 parser fixture tests を必須確認にし、full unit / e2e は push to `dev` または `workflow_dispatch` 側で実行します。

## CI Runner Policy

Blacksmith 4 vCPU runners は、利用可能な環境では高速で効率的な候補です。ただし、この fork では `blacksmith-4vcpu-*` label の job が runner に割り当たらず `QUEUED` のまま停止しました。

そのため現在の PR では以下を使います。

- PR targeted tests: `ubuntu-latest`
- full Linux unit / e2e on push or manual run: `ubuntu-latest`
- full Windows unit / e2e on push or manual run: `windows-latest`

Blacksmith runner が GitHub / Blacksmith 側で有効化され、PR job が queue 停止しないことを確認できた場合にのみ、`blacksmith-4vcpu-*` へ戻します。性能が高くても、runner 割当が確認できない状態では採用しません。

## Next Phases

次フェーズで検討する項目は以下です。

- bounded handoff injection
- model-switch bridge
- wiki validation / writer automation
- MT5 report parser integration
- evidence-backed promotion workflow
- session restart / compaction / model switch を跨ぐ memory admission proof
- human-approved live transition workflow
