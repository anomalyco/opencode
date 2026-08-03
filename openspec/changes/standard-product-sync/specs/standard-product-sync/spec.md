## ADDED Requirements

### Requirement: Authoritative workbook admission
The synchronizer SHALL accept only the workbook whose sheet has the exact headers `原始行号`, `商品编码`, `商品名称`, `产地`, `数量`, `货架号`, `规格`, `型号`, and `备注`; it SHALL compute a SHA-256 identity, reject empty or duplicate normalized product codes, and preserve every admitted cell as run evidence.

#### Scenario: Approved workbook is admitted
- **WHEN** the workbook contains the exact headers, 10,560 non-empty rows, and one unique normalized product code per row
- **THEN** Preview records its file name, SHA-256, headers, row count, source rows, and normalized shelf tokens without writing business data

#### Scenario: Workbook identity is invalid
- **WHEN** the file is missing, unreadable, has different headers, has duplicate or blank product codes, or contains an invalid non-empty shelf value
- **THEN** the synchronizer fails before creating a run or changing MySQL data

### Requirement: Deterministic legacy identity reconciliation
The synchronizer SHALL reconcile authoritative rows to `Product.s_ID` without treating `Product.u_Code` as unique. One code candidate maps automatically; multiple candidates map only when exactly one deterministic candidate is proven; no candidate is `MISSING`; unresolved multiple candidates are `AMBIGUOUS` and MUST NOT update any legacy row.

#### Scenario: One legacy candidate exists
- **WHEN** one authoritative code resolves to exactly one normalized `Product.u_Code`
- **THEN** the mapping records that `Product.s_ID` as `MATCHED`

#### Scenario: Duplicate legacy code is uniquely resolved
- **WHEN** multiple legacy rows share the code and exactly one candidate matches the deterministic approved-field comparison
- **THEN** only that candidate is mapped and the complete candidate evidence is retained

#### Scenario: Duplicate legacy code remains ambiguous
- **WHEN** zero or multiple candidates survive deterministic comparison
- **THEN** the mapping is `AMBIGUOUS`, no candidate is updated, and Preview lists every candidate

#### Scenario: Legacy product is missing
- **WHEN** no `Product` row has the authoritative code
- **THEN** the row is stored as `MISSING` in the authoritative dataset and the synchronizer MUST NOT invent `s_ParentID` or insert an incomplete `Product` row

### Requirement: Protected Product field synchronization
For every `MATCHED` row, Apply SHALL synchronize only `Product.u_Name`, `Product.ProdArea`, `Product.ProdType`, `Product.ProdSpec`, and `Product.u_Remark`; it SHALL map workbook `规格` to `ProdType` and workbook `型号` to `ProdSpec`, treat approved blanks as SQL `NULL`, and MUST NOT modify product keys, hierarchy, other legacy columns, or `Storage`.

#### Scenario: Matched product is synchronized
- **WHEN** a matched row contains approved name, origin, specification, model, and remark values
- **THEN** those five mapped Product fields exactly equal the approved values after Apply

#### Scenario: Approved field is blank
- **WHEN** an approved display field is blank in the workbook
- **THEN** the corresponding mapped Product field becomes `NULL` and its previous value remains recoverable in the run backup

#### Scenario: Inventory is protected
- **WHEN** Apply synchronizes any number of authoritative products
- **THEN** the count and value fingerprint of all `Storage` rows is unchanged

### Requirement: Authoritative structured shelf replacement
The synchronizer SHALL normalize workbook shelf tokens to uppercase ASCII A-D three-part codes and, for each `MATCHED` row, replace that product's structured shelf relations with exactly the approved set. It MUST back up previous relations and evidence and SHALL identify new evidence as `StandardWorkbook`.

#### Scenario: Product has multiple approved shelves
- **WHEN** a workbook cell contains `A-1-4+A-1-1`
- **THEN** the authoritative and mapped product shelf sets contain exactly `A-1-4` and `A-1-1`, independent of order

#### Scenario: Product has no approved shelf
- **WHEN** the workbook shelf cell is blank
- **THEN** the matched product has no active structured shelf relation after Apply

#### Scenario: Legacy shelf is stale
- **WHEN** a matched product currently has a shelf absent from the workbook
- **THEN** Apply removes that relation only after backing it up and validation confirms it no longer appears in the active view

### Requirement: Versioned authoritative query projection
The database SHALL retain every approved row in a versioned authoritative dataset and expose only the single active applied run through standard product and shelf views. Database-only legacy products MUST NOT appear. Inventory SHALL use live `Storage` totals for `MATCHED` rows and the workbook quantity only for `MISSING` or `AMBIGUOUS` rows.

#### Scenario: Matched product is queried
- **WHEN** an active authoritative row maps to one Product row
- **THEN** the projection returns approved display fields and shelves with the live Storage total

#### Scenario: Unmapped approved product is queried
- **WHEN** an active authoritative row is missing or ambiguous in Product
- **THEN** the projection still returns the approved row and shelves using its workbook quantity without fabricating a legacy identity

#### Scenario: Legacy-only product exists
- **WHEN** a Product code is absent from the active workbook run
- **THEN** it is excluded from the authoritative query projection and remains unchanged in Product

### Requirement: Atomic apply and affected-row protection
Apply SHALL use one DML transaction after idempotent object setup, require exact expected affected-row bounds, lock active-run state, and roll back all run data, Product updates, shelf replacements, and activation changes when any statement or post-write assertion fails.

#### Scenario: Apply succeeds
- **WHEN** Preview evidence, schema identity, workbook identity, mapping counts, and affected-row bounds still match at transaction start
- **THEN** the run becomes active only after all writes and in-transaction assertions succeed

#### Scenario: Concurrent or stale apply is attempted
- **WHEN** the active run, source hash, schema contract, mapping count, or expected affected-row count differs from Preview
- **THEN** Apply fails closed without partial business changes

#### Scenario: Statement fails during apply
- **WHEN** any backup, Product update, shelf replacement, staging, or activation statement fails
- **THEN** the transaction rolls back and the previously active run and business data remain active

### Requirement: Run-scoped rollback
Rollback SHALL require an applied `run_id`, restore every backed-up Product field and shelf relation/evidence, reactivate the recorded previous run, and validate the restored state in one transaction. It MUST NOT delete audit evidence for the rolled-back run.

#### Scenario: Applied run is rolled back
- **WHEN** rollback receives the active applied run ID
- **THEN** all affected Product fields and shelves equal their backed-up values, the prior run is active, and the target run is marked rolled back

#### Scenario: Invalid rollback target
- **WHEN** the run is missing, was never applied, is not active, or lacks complete backup evidence
- **THEN** rollback fails before changing business data

### Requirement: Exact validation and audit evidence
The synchronizer SHALL validate workbook rows, unique codes, mapping statuses, mapped Product fields, authoritative and mapped shelf sets, unchanged Storage, view results, orphan/duplicate relations, transaction state, and rollback evidence. Write and high-risk gold cases MUST pass 100%; credentials and complete connection strings MUST never enter reports or database audit rows.

#### Scenario: Applied run validates
- **WHEN** every required invariant exactly matches the approved workbook and protected database state
- **THEN** validation records 100% for business intent, SQL scope, execution result, and result explanation and permits robot cutover

#### Scenario: Any invariant fails
- **WHEN** one row, field, shelf, mapping, Storage fingerprint, relation, view, or audit invariant differs
- **THEN** validation fails, robot cutover is blocked, and the difference is retained under the run ID
