## 1. Workbook and reconciliation contract

- [x] 1.1 Add `packages/feishu/test/standard-product-sync.test.ts` RED cases for exact workbook headers, 10,560-row uniqueness, blank/duplicate code rejection, A-D shelf normalization, `规格 -> ProdType`, `型号 -> ProdSpec`, authoritative blanks, and protected inventory; run `bun test test/standard-product-sync.test.ts` from `packages/feishu` and confirm failure because `src/standard-product-sync.ts` does not exist.
- [x] 1.2 Implement the minimal pure parser/reconciliation API in `packages/feishu/src/standard-product-sync.ts` plus the read-only XLSX bridge `packages/feishu/scripts/read-standard-product-workbook.py`; rerun `bun test test/standard-product-sync.test.ts` and confirm all parser/reconciliation tests pass.
- [x] 1.3 Add duplicate-candidate and missing-product RED/GREEN cases proving one candidate maps automatically, a duplicate maps only with one exact deterministic candidate, unresolved duplicates stay `AMBIGUOUS`, missing rows stay `MISSING`, and neither status invents `s_ParentID`; run `bun test test/standard-product-sync.test.ts` from `packages/feishu` and confirm pass.

## 2. Versioned MySQL synchronization

- [x] 2.1 Add RED tests in `packages/feishu/test/standard-product-sync.test.ts` for idempotent authoritative/audit DDL, parameterized batch staging, allowed Product columns, `Storage` write exclusion, shelf backup/replacement, expected-row guards, transaction rollback, run-scoped rollback, and secret-free reports; run the focused test and confirm the missing database planner fails.
- [x] 2.2 Implement setup, Preview, Apply, Validate, and Rollback planners/executors in `packages/feishu/src/standard-product-sync.ts` and CLI wiring in `packages/feishu/scripts/standard-product-sync.ts`; run `bun test test/standard-product-sync.test.ts` and confirm the complete unit suite passes.
- [x] 2.3 Add `standard-product:preview`, `standard-product:apply`, `standard-product:validate`, and `standard-product:rollback` scripts plus usage and safety boundaries in `packages/feishu/package.json` and `packages/feishu/README.md`; run `bun test test/readme.test.ts test/standard-product-sync.test.ts` and `bun typecheck` from `packages/feishu` and confirm pass.

## 3. Live preview and database apply

- [x] 3.1 Run the CLI Preview against `D:\opencode\商品信息(1)_结构化清洗.xlsx` and configured MySQL; verify database/schema/version/account, SHA-256, exact headers, 10,560 unique codes, mapping status counts, per-field differences, 1,120 observed shelf differences, unchanged Storage fingerprint, and no database writes.
- [x] 3.2 Run Apply only with the exact Preview hash and expected counts; verify one active standard run, complete Product/shelf backups, bounded Product updates, authoritative shelf replacement, zero Storage writes, and no partial transaction on any assertion failure.
- [x] 3.3 Run Validate for the applied `run_id`; require 10,560 authoritative rows, zero duplicate standard codes, exact standard view fields/shelves, exact Product fields for every `MATCHED` mapping, zero shelf orphans/duplicates, unchanged Storage fingerprint, and 100% write/high-risk gold cases.
- [x] 3.4 Exercise Rollback on a database transaction fixture or reversible validation run, prove backed-up Product/shelf restoration and previous-run activation, then leave the approved run active; record sanitized run IDs and counts without credentials or connection strings.

## 4. Feishu authoritative inventory reader

- [x] 4.1 Update RED cases in `packages/feishu/test/mysql-inventory.test.ts`, `packages/feishu/test/mysql-preflight.test.ts`, `packages/feishu/test/inventory-mapper.test.ts`, contract/gold fixtures, and trace tests so reads require the authoritative views, use origin as supplier, preserve live-or-workbook inventory, and reject purchase/source supplier fallback.
- [x] 4.2 Modify `packages/feishu/src/mysql-inventory.ts`, `packages/feishu/src/mysql-preflight.ts`, and `packages/feishu/src/inventory-mapper.ts` to query the active authoritative product/shelf projections and remove `ListBuy`, `MasterBill`, `Units`, and source-overlay supplier presentation; run all affected focused tests and confirm pass.
- [x] 4.3 Run the explicit MySQL contract query for `001011` and representative missing/ambiguous products; confirm `001011 / 6001ZZ` returns shelves `A-1-4、A-1-1`, supplier `虎旺`, approved display fields, and no internal product code in final output.

## 5. Verification and rollout

- [x] 5.1 Run `bun test`, `bun typecheck`, and `bun run lint` from `packages/feishu`; require zero failures and no credential/path leakage.
- [x] 5.2 Run `openspec-cn validate standard-product-sync --type change --strict --json` and `git diff --check` from `D:\opencode`; require valid artifacts and no whitespace errors, then use `openspec-verify-change` and `superpowers:verification-before-completion` against every requirement.
- [x] 5.3 Restart the Feishu gateway only after database and package verification pass; verify one fresh WebSocket-ready event, zero post-ready stderr errors, and a live `6001ZZ` reply using the approved one-line format and authoritative supplier/shelves.

## 6. Latest workbook inventory date and remark merge

- [x] 6.1 Add RED cases in `packages/feishu/test/standard-product-sync.test.ts` for the exact 10-column header, 10,572-row workbook shape, separately preserved `盘点日期`/source `备注`, and the four blank/non-blank merge combinations; run the focused test and confirm it fails against the nine-column parser.
- [x] 6.2 Implement the 10-column parser and additive authoritative table upgrade in `packages/feishu/src/standard-product-sync.ts`, stage both raw values plus the merged display remark, and keep the existing robot query contract; run focused tests, `bun typecheck`, and `bun run lint` from `packages/feishu`.
- [x] 6.3 Admit the latest workbook's approved adjacent shelf tokens and literal `非标` annotation while rejecting all other unmatched text; Preview `D:\opencode\商品信息8.3_结构化清洗.xlsx`, then Apply only with its exact SHA-256, 10,572 rows, mapping counts, and current active run guard; Validate raw/derived remarks, Product fields, shelves, views, and unchanged Storage at 100%.
- [x] 6.4 Run the MySQL contract and full package suite, restart the single gateway process, and verify representative live queries including `6001ZZ` return the latest supplier/shelves and the merged remark without any product code.
