# Development Workflow

## 位置づけ

この文書は `opencode-trade` で作業を始めるときの実運用入口である。

上位契約は [AGENTS.md](./AGENTS.md) に置く。Trading plan と risk gate は [EA_TRADING_PLAN.md](./EA_TRADING_PLAN.md) を正とする。Sentinel 固有作業は [SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md](./SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md)、重大修正や監査反映は [STRICT_REMEDIATION_PLAN.md](./STRICT_REMEDIATION_PLAN.md)、remote MT5 compile と smoke は [REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md](./REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md) を参照する。

文書が衝突した場合は、まず `AGENTS.md` のハード境界を優先する。EA / risk / live gate の判断では `EA_TRADING_PLAN.md`、`SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md`、`STRICT_REMEDIATION_PLAN.md`、この文書の順で解釈する。

## Runtime Model Routing

`.opencode/opencode.jsonc` は、opencode runtime が読むモデル/provider の実行契約である。モデルや provider policy を複数文書で再定義しない。

現在の意図:

- `model`: 通常実行の標準モデル。
- `small_model`: runtime の小型モデル候補。作業分類や低コストモデル運用全体の routing 契約ではない。
- `agent.plan.model`: 設計、調査、計画に使う高性能モデル。
- `agent.review.model`: 監査、レビュー、品質確認に使うモデル。
- `experimental.policies`: provider 使用可否の制約。

`.opencode/opencode.jsonc` を変更するときは、schema と provider ID を確認し、変更後に opencode を再起動する。ChatGPT Pro / Codex 側の利用と、opencode runtime の provider 利用を混同しない。

## Task Classes and Escalation

Class A: 文言整形、差分要約、リンク確認、単純な README 修正。

Class B: 1-2 ファイルの局所修正、軽い docs 整備、小さなテスト追加。

Class C: `AGENTS.md`、`DEVELOPMENT.md`、`.opencode/opencode.jsonc`、branch policy、risk gate、複数文書設計。

Class D: 監査、整合性判定、重大バグ、MT5 order execution、risk logic、live gate 判断。

低コストモデルは Class A と、範囲を明確にした Class B に限定して使う。Class C / D は plan、review、または Codex 側へ昇格する。

## Low-Cost Model Guardrails

低コストモデルは draft、normalize、summarize、extract を担当する。以下の最終判断は任せない。

- model routing
- provider policy
- branch policy
- risk gate
- live trading readiness
- MT5 order execution
- cross-document authority conflicts

低コストモデルの成果物は、受け入れ前に `AGENTS.md`、`DEVELOPMENT.md`、`.opencode/opencode.jsonc`、タスク固有の canonical document と照合する。

## Reference Routing

作業タイプごとに、最小限の関連文書だけを読む。動的ルールローダーは導入しない。リポジトリが読める状態であれば、ユーザーにルールファイルの貼り付けを求めない。

| 作業タイプ | 最初に読む | 次に読む |
|---|---|---|
| 文書整備 | `AGENTS.md` | `DEVELOPMENT.md`, 対象文書 |
| README 更新 | `AGENTS.md` | `README.md`, `README.ja.md`, `DEVELOPMENT.md` |
| branch 整理 | `AGENTS.md` | `DEVELOPMENT.md`, `docs/github-branch-workflow.md` |
| opencode 設定変更 | `AGENTS.md` | `.opencode/opencode.jsonc`, `packages/core/src/plugin/skill/customize-opencode.md`, schema |
| opencode core / SessionV2 | `AGENTS.md` | `specs/v2/session.md`, `specs/v2/schema-changelog.md`, 対象コード |
| memory handoff | `AGENTS.md` | `MEMORY_HANDOFF_ARCHITECTURE.md`, `.opencode/plugins/trade-handoff-bridge.ts` |
| EA / MQL5 | `AGENTS.md` | `EA_TRADING_PLAN.md`, `ARCHITECTURE.md`, `src/Include/*` |
| risk / gate | `AGENTS.md` | `EA_TRADING_PLAN.md`, `STRICT_REMEDIATION_PLAN.md`, `risk/gates.yaml` |
| MT5 remote | `AGENTS.md` | `REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md`, `docs/mt5-report-recovery-runbook.md` |

## Repository Setup

Primary fork:

```bash
git clone https://github.com/TakeshiSawaguchi/opencode-trade.git
cd opencode-trade
```

Optional upstream remote for comparison only:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git remote -v
```

古いメモの Codeberg path や remote 名を前提にしない。必ず現在の checkout の remote 設定を確認する。

## Branch Model

- `dev` を共有 mainline とする。
- 実装量の多い進行中作業は `opencode` 側の `feature/...` branch で扱う。
- `codex` 側の周辺作業は短命の `docs/...` または `fix/...` branch を使い、`dev` へ merge / cherry-pick 後に速やかに削除する。
- `wip/...` branch や detached worktree は、未完了状態を保存する明確な理由がある場合だけ使う。

## Node Layout

`wag-air` (Mac): orchestration、文書、branch work、parser / unit test、artifact review、promotion decision。

`wag-x870e` (Ubuntu): historical data collection、Python-side preprocessing、research support、non-MT5 batch work。

`wag-dell` (Windows / MT5): MetaTrader 5 compile、tester execution、full EA bundle deployment、fresh tester logs and reports。

このプロジェクトは research、implementation、MT5 execution が1台で完結する前提を置かない。

## Local Preflight

作業前に必ず現在の差分を確認する。

```bash
git status --short --branch
```

TypeScript / Bun 側のテストは repo root から実行しない。`packages/opencode` など該当 package directory へ移動して実行する。

```bash
cd packages/opencode
bun typecheck
bun test test/tool/<target>.test.ts
```

`tsc` を直接実行しない。型検査は package directory で `bun typecheck` を使う。

Parser regression check:

```bash
cd src/Scripts/tests
python -m unittest -v test_analyze_mt5_report.py
```

OpenCode workspace commands remain available when you need the upstream runtime:

```bash
bun install
bun run dev
```

## Working Loop

1. `EA_TRADING_PLAN.md` を読み、active phase を確認する。
2. 作業が `RiskManagement`、parser/gates、Sentinel boundaries に触れるか確認する。
3. その phase に必要なファイルだけを更新する。
4. gate または report logic を変更したら parser tests を実行する。
5. MT5-side behavior が変わる場合は full EA bundle を `wag-dell` へ deploy する。
6. compile、smoke、parser gate checks を実行する。
7. pass、hold、reject の evidence を `backtest/results/` に記録する。

Project rule: `Safety Gate first. Strategy second. ML last.` Live trading remains `NO-GO` until the critical gates in `EA_TRADING_PLAN.md` are complete.

## Full Bundle Deployment

dependent includes が変わった場合、single-file MT5 sync は禁止する。

Deploy the full bundle:

```text
src/Expert_Main.mq5
src/Include/BrokerSymbolProfile.mqh
src/Include/TradeExecutor.mqh
src/Include/RiskManagement.mqh
src/Include/TradeLogic.mqh
src/Include/DataFeed.mqh
backtest/gate_config.json
backtest/tester/*.ini
```

remote compile と smoke の正確な手順は [REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md](./REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md) を使う。

## Expected Artifacts

他フェーズが消費する evidence は既存の repository path に置く。

- `backtest/results/` for pass/fail JSON and captured gate output
- `backtest/tester/` for tester config inputs
- `src/Scripts/tests/` for parser regression tests

candidate を reject した場合、理由と evidence を残し、黙って置き換えない。

## Common Entry Points

- Trading plan and gates: [EA_TRADING_PLAN.md](./EA_TRADING_PLAN.md)
- Sentinel design: [SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md](./SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md)
- Strict remediation constraints: [STRICT_REMEDIATION_PLAN.md](./STRICT_REMEDIATION_PLAN.md)
- Remote MT5 execution: [REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md](./REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md)
- Branch workflow: [docs/github-branch-workflow.md](./docs/github-branch-workflow.md)
- Memory handoff architecture: [MEMORY_HANDOFF_ARCHITECTURE.md](./MEMORY_HANDOFF_ARCHITECTURE.md)
- Architecture overview: [ARCHITECTURE.md](./ARCHITECTURE.md)
