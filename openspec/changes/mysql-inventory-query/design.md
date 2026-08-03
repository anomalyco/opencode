## Context

The active `feishu-chat-gateway` change defines a database-free Feishu transport and has not yet created `packages/feishu`. This change adds the first business query after that transport: inventory and shelf-location reads against migrated MySQL, plus a deterministic answer formatter. The formatter and query contract can be implemented and tested independently, while final trusted gateway-route and worker wiring depends on the gateway package interfaces.

A read-only schema inspection on 2026-07-31 confirmed MySQL `8.4.10` and schema `t1_full_20260717_133707`. It confirmed `Product.s_ID` as the product key, product fields `u_Name`, `ProdSpec`, `ProdType`, and `u_Remark`, inventory rows in `Storage`, structured shelf rows in `vw_productshelflocation`, and optional structured source attribution in `erp_inventory_source_projection` plus `erp_partner_overlay`. The example product data includes `6001ZZ`, `ProdType=清油`, `ProdSpec=12*28*8`, and a Storage total of `200`.

A second read-only inspection on 2026-08-03 confirmed that structured source attribution is absent for the live `6001ZZ` matches, while migrated MySQL purchase data links `ListBuy.Prod_ID` through `MasterBill.Unit_ID` to supplier names in `Units`. For example, the current-total `177` product has a latest valid purchase supplier of `虎旺轴承`, and the `清油` current-total `200` product has a latest valid purchase supplier of `天宇轴承`. The literal `上海涂众轴承` does not exist in the live supplier data and remains only a formatting example. A first implementation through the presentation view `b_vw_master` exceeded 20 seconds for 20 matched products because that view joins many unrelated display tables; the equivalent fixed `ListBuy`/`MasterBill`/`Units` query completed in about 85 milliseconds and is the approved runtime path.

The user has explicitly retired the T1 SQL Server read path. The MySQL schema still contains migrated tables with legacy names and `LEGACY` reference kinds; those are MySQL data, not permission to connect to the old SQL Server.

## Goals / Non-Goals

**Goals:**

- Answer product inventory or shelf questions from migrated MySQL only.
- Enforce trusted Feishu context and expose only a fixed parameterized read operation.
- Map product, size, attribute, structured shelves, inventory, reliable supplier display, and remark into an identifier-free domain object.
- Produce the exact approved one-line format deterministically, with multiple objects separated only by newlines.
- Preserve append-only trace evidence and meet the 95% read gold-case gate.
- Remove T1 SQL Server from runtime architecture, configuration, tests, recovery, and roadmap language while retaining historical files.

**Non-Goals:**

- Arbitrary SQL, database writes, stored procedures, or general business reporting.
- Rebuilding the product-shelf extraction tables or modifying source product/inventory rows.
- Treating a historical purchase supplier as proof that the current stock quantity belongs to that supplier.
- Guessing suppliers from free text, remarks, product names, unapproved or red-letter bills, non-positive purchase rows, or unmatched IDs.
- Returning internal product codes, IDs, tables, match summaries, or model-authored presentation.
- Deleting or rewriting T1 historical investigation documents.

## Decisions

### 1. Add a narrow inventory module under `packages/feishu`

The change adds focused modules for the answer-domain contract, deterministic formatting, MySQL schema/query adapter, and the trusted inventory service boundary. This keeps MySQL dependencies and business mapping out of Core, Protocol, Server, and the transport-only gateway modules.

Alternative considered: place the query in OpenCode core or expose arbitrary SQL through an existing tool. That would violate dependency boundaries, broaden permissions, and make the response contract dependent on model behavior.

### 2. Use `mysql2/promise@3.14.4` behind a narrow injected query port

`mysql2` is already locked in the monorepo and provides prepared statements, decimal strings, pooling, and explicit connection lifecycle. Configuration uses host, port, database, user, and a controlled password-file path; secret values are read at process startup and never logged.

Alternative considered: a shell `mysql` client or SQL Server-compatible adapter. Shell execution expands the attack surface and complicates secret handling; a cross-database adapter preserves a fallback the user explicitly removed.

### 3. Run an identity and schema preflight before enabling the tool

Preflight checks MySQL version, `DATABASE()`, `CURRENT_USER()`, `@@read_only`, required tables/views/columns, and the application schema version when present. Server `@@read_only=0` is acceptable because the database supports other application writes, but this change exposes only versioned prepared `SELECT` templates.

Alternative considered: discover fields lazily during the first employee question. That makes schema drift a user-facing partial failure and invites unsafe field substitution.

### 4. Keep the answer domain identifier-free

The adapter may use `Product.s_ID` and source/warehouse keys internally for joins, but it returns an `InventoryAnswerItem` containing only:

```ts
type InventoryAnswerItem = {
  name: string
  attribute?: string
  size?: string
  shelves: string[]
  supplier?: string
  inventory?: string
  remark?: string
}
```

There is no property for `s_ID`, `u_Code`, an `SP...` code, supplier ID, or warehouse ID. This makes leakage harder than relying on prompt instructions or a final text scrub.

### 5. Define current inventory and supplier display explicitly

The current product total is `SUM(Storage.Prod_Number1)` grouped by `Product.s_ID`. The query maps dimensions from `Product.ProdSpec`, attributes from `Product.ProdType`, remarks only from `Product.u_Remark`, and shelves only from `vw_productshelflocation`.

When `erp_inventory_source_projection` resolves a positive or zero source row to an enabled, non-deleted `erp_partner_overlay` with role `SUPPLIER`, the mapper emits a product-supplier item using that source `on_hand_qty`. Multiple suppliers produce multiple answer items. Structured source attribution always takes precedence over the fallback below.

When no active structured supplier source exists, the adapter looks up the latest reliable migrated purchase for the same `Product.s_ID`. A reliable fallback row must join `ListBuy.Bill_ID` to `MasterBill.AutoID`, join `MasterBill.Unit_ID` to `Units.s_ID`, have `MasterBill.BillState=3`, `MasterBill.s_Syb=0`, `ListBuy.Prod_Number > 0`, and a non-empty `Units.u_Name`. The latest row is selected deterministically by `MasterBill.BillDate DESC`, `MasterBill.AutoID DESC`, then `ListBuy.List_ID DESC`. The mapper displays that supplier beside the product's current total inventory; it does not claim that the total is supplier-attributed. If no reliable purchase row exists, the supplier is omitted.

Alternatives considered:

- Keep omitting suppliers whenever the source projection is empty. This preserves strict stock attribution but does not satisfy the approved requirement to show the actual supplier for migrated products.
- Populate source projections automatically from purchase history. Historical purchases cannot reconstruct the remaining supplier-specific stock after later sales, returns, and adjustments, so automatic backfill would fabricate provenance.
- Use free text or a fixed example supplier. That would not be actual database data.

### 6. Extract display fields without reusing shelf text

The size mapper recognizes dimension tokens in `ProdSpec` and normalizes `*`, `x`, or `X` to `×`. The attribute mapper uses non-empty `ProdType` only after excluding values that consist solely of recognized shelf tokens. Shelves come from the structured relation, and `u_Remark` is never parsed as another field.

This deliberately omits uncertain text instead of copying a mixed raw field into the wrong parenthetical.

### 7. Format outside the model

The formatter builds one physical line per `InventoryAnswerItem` in the approved sequence:

```text
6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx
```

It omits absent optional fragments, renders supplierless inventory as `库存200`, joins unique shelves with `、`, normalizes field-internal CR/LF to spaces, and joins items with exactly one newline. The worker sends this returned string as the final Feishu reply without a second model turn.

Alternative considered: prompt-only formatting or SQL projection followed by model rewriting. Both allow the table, code, labels, and commentary to drift.

### 8. Route inventory before chat-model execution

After the transport change exists, the trusted gateway classifies inventory and shelf-location requests before invoking OpenCode. A recognized request with a usable product term calls only the fixed inventory service and sends its formatter output through the normal final-delivery path; it does not invoke or resume the chat model. Ordinary chat continues to use the `feishu-chat` Agent with an empty tool set and default-deny permissions. File, terminal, network, arbitrary SQL, database write, Skill chaining, MCP, and project modification remain denied.

### 9. Trace the four gold-case layers

The gateway appends intent admission, route decision, fixed-service input, query-template version, sanitized parameters, MySQL/schema identity, execution timing and row count, mapped answer items, final plain text, delivery, feedback, and corrections to the existing trace. SQL credentials, password paths, complete connection strings, hidden reasoning, and secret-bearing errors are excluded.

Gold cases separately score intent, SQL template/parameters, result mapping, and final answer. Read accuracy must reach at least 95% on every reported layer; policy and secret-exclusion cases must pass 100%.

## Risks / Trade-offs

- [Supplier source projections are incomplete for migrated inventory] → Fall back to the latest reliable migrated purchase supplier and show the current product total; do not describe the total as supplier-attributed stock.
- [A product may have several historical suppliers] → Select the latest reliable purchase deterministically and let active structured source attribution override the fallback whenever it becomes available.
- [The migrated Product fields mix sizes, attributes, and old shelf tokens] → Use narrow recognized extraction plus the structured shelf view and omit uncertain fragments.
- [Duplicate visible names produce apparently similar lines] → Keep `Product.s_ID` as the internal identity and deterministic order, while honoring the requirement not to display it.
- [A broad substring can return many products] → Require a usable product term, use a bounded configured result limit, and preserve deterministic ordering without adding a summary.
- [MySQL is writable for other application capabilities] → Limit this tool to prepared `SELECT` templates and test that no write-capable method is reachable.
- [The Feishu gateway is not yet implemented] → Land and verify the inventory domain/formatter/query adapter independently, then wire the trusted pre-model route only after the gateway interfaces exist.
- [Schema or business interpretation changes] → Fail preflight or gold cases, append a correction, and update the versioned mapping rather than silently changing fields.

## Migration Plan

1. Remove T1 runtime/fallback language from current project and Feishu gateway planning while retaining historical documents.
2. Add the inventory answer type and formatter with red-green tests for the exact approved sentence and prohibited output.
3. Add configuration, MySQL preflight, prepared query templates, structured source mapping, latest-valid-purchase supplier fallback, and gated local contract tests.
4. Add trace events, four-layer gold cases, and the 95% release gate.
5. After `feishu-chat-gateway` provides its admission/worker interfaces, add the trusted pre-model inventory route and send formatter output verbatim while keeping the Agent tool set empty.
6. Run a local read-only smoke query for `6001ZZ` and a multi-result query, then verify no code, table, T1 connection, or secret appears.

Rollback disables the inventory route and removes its runtime configuration. The change performs no MySQL writes or schema migrations, so database rollback is not required.

## Open Questions

None. Structured source attribution remains authoritative. Purchase history is used only as an approved supplier-display fallback with current product total inventory, and the supplier is omitted when neither source is reliable.
