# Strict Remediation Plan

`DEVELOPMENT.md` で参照される安全制約・リカバリ手順を簡潔化した運用メモです。

## 受け入れ不備時の最優先ルール

1. `full bundle` 未整合なら再配備
2. parser gate (`src/Scripts/analyze_mt5_report.py`) で `passed=false` を出した場合は merge/progress 停止
3. 重大な拒否ルール（No money / margin / invalid stops / order rejection / JPY risk breach / global stop 後注文）がある場合は原因解消まで候補進行停止
4. `backtest/results/` に証跡を残す

## リメディエーション手順

- 根因を 1件ずつ明文化（ログ参照・シナリオ・再現条件）
- 対応候補を最小差分で切り分けて再実行
- 再実行成功後にのみ次フェーズへ進む
- ログと parser 出力から不一致や推定値が外れる場合は直ちにレビューへ連携

## 例外

- live trading 有効化を前提とした例外承認は原則不可
- 既存の `EA_TRADING_PLAN.md` / `FINAL_IMPLEMENTATION_PLAN.md` の NO-GO 条件を上書きしない

## EA Lab Final Remediation Plan

### 状態

- この節は EA Lab memory / risk gate / handoff 監査の最終修正案。
- 実装順は最小差分優先。
- 目的は advisory gate を強制 gate に変え、secret-like data の保存漏れを塞ぐこと。

### 非交渉ルール

- promotion/live 遷移は fail-closed で扱う。
- `micro_live` / `limited_live` は AI path では常に危険遷移扱いにする。
- human override path は今回追加しない。
- redaction は保存前に行い、searchable persistence に raw secret を入れない。
- enforcement は DB core ではなく `ea-lab-service.ts` に置く。

### 実装修正対象

- `.opencode/ea-lab-core/redaction.ts`
- `.opencode/ea-lab-core/evidence.ts`
- `.opencode/ea-lab-core/experiences.ts`
- `.opencode/ea-lab-core/experiments.ts`
- `.opencode/ea-lab-core/risk-gates.ts`
- `.opencode/mcp/ea-lab-service.ts`
- `.opencode/mcp/ea-lab-server.ts`
- `packages/opencode/test/tool/ea-lab-redaction.test.ts`
- `packages/opencode/test/tool/ea-lab-evidence.test.ts`
- `packages/opencode/test/tool/ea-lab-experiments.test.ts`
- `packages/opencode/test/tool/ea-lab-risk-gates.test.ts`
- `packages/opencode/test/tool/ea-lab-service.test.ts`

### Step 1: Redaction 強化

1. `redaction.ts` に sensitive key 判定を追加する。
2. 対象 key は `token`, `api_key`, `api-key`, `secret`, `password`, `access_token`, `refresh_token`, `client_secret`。
3. key 判定は case-insensitive にする。
4. URL/query/fragment redaction を追加する。
5. `?token=...`, `&api_key=...`, `#access_token=...` の値だけ `[REDACTED_SECRET]` に置換する。
6. 非 secret param 例 `symbol=XAUUSD` は保持する。
7. `redactEaLabJson()` を key-aware にする。
8. JSON object の key が sensitive key なら、値全体を `[REDACTED_SECRET]` にする。
9. nested object / array も再帰 redaction する。
10. `storeEvidence()` の locator redaction は現行経路を維持しつつ、強化した redaction に乗せる。

### Step 2: Risk Gate 強制化

1. `ea-lab-service.ts` の mutating path でだけ enforcement する。
2. `storeExperiment()` の DB 書き込み前に gate 判定する。
3. `updateExperimentResult()` の DB 書き込み前に gate 判定する。
4. `updateExperimentResult()` では current row から `result_status`, `stage`, `metrics_json`, `overfit_risk` を読む。
5. `finalStatus = input.result_status ?? current.result_status`。
6. `finalStage = input.stage ?? current.stage`。
7. `isPromotion = finalStatus === "promoted"`。
8. `isLiveStage = finalStage === "micro_live" || finalStage === "limited_live"`。
9. `mustGate = isPromotion || isLiveStage`。
10. `mustGate === false` の通常 update は許可する。
11. `mustGate === true` の場合だけ `checkRiskGates()` を必須実行する。
12. `wantsLiveTrading = input.wantsLiveTrading ?? isLiveStage`。
13. `requestedAction = isPromotion || isLiveStage ? "promote" : "update"`。
14. `hasOutOfSample`, `hasSpreadSensitivity`, `hasDemoForward` は未指定なら `false`。
15. promotion/live 遷移時に `trade_count` が missing または non-finite なら hard violation。
16. promotion/live 遷移時に `max_drawdown_percent` が missing または non-finite なら hard violation。
17. gate failure は DB mutation 前に throw する。
18. error message には violation names を含める。
19. failed update 後に row が不変であることをテストする。
20. DB core (`experiments.ts`) には policy を入れない。

### Step 3: MCP 入力面の整備

1. `ea_lab_store_experiment` に optional safety fields を追加する。
2. `has_out_of_sample`
3. `spread_slippage_documented`
4. `has_demo_forward`
5. `wants_live_trading`
6. `wants_lot_increase`
7. `wants_gate_relaxation`
8. `uses_martingale`
9. `uses_grid`
10. `has_hard_max_loss`
11. `optimized_on_single_period_only`
12. `ea_lab_update_experiment_result` にも同じ optional safety fields を追加する。
13. `ea_lab_check_risk_gates` は advisory tool として残す。

### Step 4: テスト追加

1. `ea-lab-redaction.test.ts`
2. lowercase query secrets を redaction する。
3. `token`, `api_key`, `secret`, `password`, `access_token`, `refresh_token`, `client_secret` を確認する。
4. `symbol=XAUUSD` が残ることを確認する。
5. JSON key `token` / `api_key` の値が redacted されることを確認する。
6. `ea-lab-evidence.test.ts`
7. `stored.uri` に raw token が残らないことを assert する。
8. `stored.file_path` に raw api key が残らないことを assert する。
9. `stored.checksum` に raw refresh token が残らないことを assert する。
10. `stored.description` に lowercase query secret が残らないことを assert する。
11. `ea-lab-experiments.test.ts`
12. `test_conditions_json` の nested URL query secret が redacted されることを assert する。
13. `metrics_json` の nested URL query secret が redacted されることを assert する。
14. `{"token":"raw"}` の key-based secret が redacted されることを assert する。
15. `updateExperimentResult()` の `metrics_json` も redacted されることを assert する。
16. `ea-lab-risk-gates.test.ts`
17. `wantsLiveTrading: true` で `live_trading_ai_can_enable` を assert する。
18. `wantsLiveTrading: true` で `live_trading_requires_human_approval` を assert する。
19. `martingale`, `grid_without_max_loss`, `increase_lot_after_loss`, `live_deploy_without_demo_forward`, `optimize_on_single_period_only` は既存 assert を維持する。
20. `ea-lab-service.test.ts`
21. `storeExperiment(result_status: "promoted")` が gate failure で reject される。
22. reject 後、experiment count が `0`。
23. `storeExperiment(stage: "micro_live")` が live intent 推論で reject される。
24. `storeExperiment(stage: "limited_live")` も reject される。
25. `updateExperimentResult(result_status: "promoted")` が reject される。
26. reject 後、既存 row の `result_status`, `stage`, `metrics_json` が不変。
27. `updateExperimentResult(stage: "micro_live")` が reject される。
28. reject 後、既存 row が不変。
29. `updateExperimentResult(result_status: "failed")` は gate を強制せず成功する。

### 実装順

1. redaction pure logic を先に修正。
2. redaction unit tests を追加。
3. evidence / experiment stored redaction tests を追加。
4. service input 型と MCP schema に safety fields を追加。
5. `storeExperiment()` enforcement を追加。
6. `updateExperimentResult()` enforcement を追加。
7. service block / unchanged tests を追加。
8. `risk-gates.test.ts` の live policy assert を補強。
9. targeted tests を実行。
10. `bun typecheck` を実行。

### 完了条件

- promotion/live mutation が gate failure で必ず止まる。
- failed mutation で DB row が変わらない。
- live stage は flag 省略でも live intent と推論される。
- lowercase query secret と JSON key secret が保存値から消える。
- non-promotional failure recording は block されない。
