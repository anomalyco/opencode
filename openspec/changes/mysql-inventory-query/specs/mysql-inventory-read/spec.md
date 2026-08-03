## ADDED Requirements

### Requirement: Trusted inventory query admission
The system SHALL admit a MySQL inventory or shelf-location query only when the Feishu adapter supplies valid trusted access context. The project MUST NOT create a second user or role system.

#### Scenario: Valid trusted context
- **WHEN** a Feishu inventory or shelf-location request carries valid trusted access context
- **THEN** the system admits the fixed inventory read operation and associates it with the message trace

#### Scenario: Missing or invalid trusted context
- **WHEN** the context is missing, expired, forged, or unverifiable
- **THEN** the system fails closed before acquiring a MySQL connection and records a sanitized policy event

### Requirement: MySQL-only runtime
The system SHALL query the configured migrated MySQL schema directly and MUST NOT contain a SQL Server connection, query, driver, configuration field, or fallback branch.

#### Scenario: MySQL is available
- **WHEN** startup preflight confirms the configured MySQL identity, schema, version, and required columns
- **THEN** the inventory adapter becomes available for admitted read requests

#### Scenario: MySQL is unavailable
- **WHEN** connection, authentication, timeout, or identity validation fails
- **THEN** the system returns a sanitized single-sentence failure and does not attempt any SQL Server fallback

### Requirement: Schema preflight and drift protection
The system SHALL verify the target MySQL database identity and required schema before serving queries. The required data contract SHALL include `Product.s_ID`, `Product.u_Name`, `Product.ProdSpec`, `Product.ProdType`, `Product.u_Remark`, `Storage.Prod_ID`, `Storage.Prod_Number1`, the structured product-shelf relation exposed by `vw_productshelflocation`, structured supplier source fields in `erp_inventory_source_projection` and `erp_partner_overlay`, and purchase fallback fields `ListBuy.List_ID`, `ListBuy.Bill_ID`, `ListBuy.Prod_ID`, `ListBuy.Prod_Number`, `MasterBill.AutoID`, `MasterBill.Unit_ID`, `MasterBill.BillDate`, `MasterBill.BillState`, `MasterBill.s_Syb`, `Units.s_ID`, and `Units.u_Name`.

#### Scenario: Required schema matches
- **WHEN** the configured database contains the required tables, view, keys, and compatible field types
- **THEN** preflight records the MySQL schema version and enables the query adapter

#### Scenario: Required schema drifts
- **WHEN** a required table, view, key, or compatible field is missing or changed
- **THEN** the adapter fails closed without guessing a replacement field or querying an old database

### Requirement: Fixed read-only query surface
The system SHALL expose only parameterized product inventory and shelf-location reads in this change. It MUST NOT accept model-authored SQL or execute `INSERT`, `UPDATE`, `DELETE`, DDL, stored procedures, or arbitrary `SELECT`.

#### Scenario: Approved inventory lookup
- **WHEN** the trusted gateway route invokes the fixed inventory service with a validated product search term
- **THEN** the adapter executes only the versioned parameterized inventory query template

#### Scenario: Unapproved database operation
- **WHEN** a request attempts a write, procedure call, arbitrary SQL, or an unrelated database read
- **THEN** the system rejects the operation before it reaches MySQL and records `operation_blocked`

### Requirement: Product and inventory mapping
The system SHALL use `Product.s_ID` as the internal product identity, SHALL calculate current inventory from `SUM(Storage.Prod_Number1)` grouped by product, SHALL obtain shelf codes from the structured product-shelf relation, and SHALL map only business-readable fields into the answer domain. `Product.u_Code` MUST NOT be mapped into the answer domain.

#### Scenario: Product has inventory and shelves
- **WHEN** a matching product has Storage rows and one or more structured shelf relations
- **THEN** the result contains its business name, attribute, normalized size, ordered unique shelf codes, inventory quantity, and remark without an internal code

#### Scenario: Product has no shelf relation
- **WHEN** a matching product has inventory but no structured shelf relation
- **THEN** the result omits shelves and MUST NOT parse a shelf from `Product.u_Remark`

#### Scenario: Duplicate business names have distinct product identities
- **WHEN** multiple `Product.s_ID` rows share the same visible name
- **THEN** the system preserves each matched product result in deterministic `Product.s_ID` order without using `u_Code` as a key

### Requirement: Supplier display and source precedence
The system SHALL use `erp_inventory_source_projection.on_hand_qty` and an active `erp_partner_overlay` supplier mapping when structured source attribution exists for a product. When no active structured supplier source exists, it SHALL fall back to the same product's latest reliable migrated purchase supplier and pair that supplier display with the product's current total inventory. It MUST NOT invent a supplier from a product name, remark, free text, fixed example, unapproved or red-letter bill, non-positive purchase row, or unmatched identifier.

#### Scenario: Supplier source is attributed
- **WHEN** a product inventory source resolves to an enabled, non-deleted supplier partner
- **THEN** the system emits one answer object for that product-supplier quantity with the supplier business name

#### Scenario: Structured source takes precedence
- **WHEN** a product has both an active structured supplier source and one or more historical purchase suppliers
- **THEN** the system uses only the structured source supplier and its `on_hand_qty` without adding a purchase fallback result

#### Scenario: Latest reliable purchase supplier fallback
- **WHEN** no active structured supplier source exists and the product has a purchase row joined through `ListBuy.Bill_ID` to `MasterBill.AutoID` and `MasterBill.Unit_ID` to `Units.s_ID`, whose bill has `BillState=3`, `s_Syb=0`, positive `Prod_Number`, and non-empty `Units.u_Name`
- **THEN** the system emits one answer object with that supplier and the product's current total inventory

#### Scenario: Purchase fallback ordering
- **WHEN** multiple reliable purchase rows exist for one product
- **THEN** the system selects exactly one row ordered by `MasterBill.BillDate DESC`, `MasterBill.AutoID DESC`, and `ListBuy.List_ID DESC`

#### Scenario: No reliable supplier exists
- **WHEN** the source is `UNATTRIBUTED`, disabled, deleted, unresolvable, or absent and no reliable purchase row exists
- **THEN** the system omits the supplier name, uses the product total inventory, and does not display “未归属”

#### Scenario: Invalid purchase rows are ignored
- **WHEN** a candidate purchase bill is unapproved or red-letter, its line quantity is zero or negative, or its supplier name is empty
- **THEN** that row cannot supply the displayed supplier name

#### Scenario: Multiple suppliers are attributed
- **WHEN** one product has multiple active supplier source rows
- **THEN** the system emits one deterministically ordered answer object per supplier source

### Requirement: Query ambiguity and empty results
The system SHALL treat an inventory or shelf question with no usable product term as ambiguous and SHALL never broaden it into an unrestricted product dump.

#### Scenario: Missing product term
- **WHEN** the request asks for inventory or location without identifying a product
- **THEN** the system asks one concise clarification and performs no database query

#### Scenario: No product matches
- **WHEN** the parameterized lookup returns no matching product
- **THEN** the system returns exactly `未找到相关商品。`

### Requirement: Query failure integrity
The system SHALL classify connection, authentication, timeout, schema, and execution failures without fabricating products, inventory, suppliers, shelves, or remarks.

#### Scenario: Query execution fails
- **WHEN** MySQL fails before a complete result set is mapped
- **THEN** the system emits no partial business answer and returns a sanitized single-sentence failure

#### Scenario: One row is malformed
- **WHEN** a returned row violates the expected field contract
- **THEN** the complete query fails closed instead of silently substituting a guessed value

### Requirement: Inventory trace and gold cases
The system SHALL append the user message, sentence events, admitted intent, gateway route decision, fixed-service call, query template version, sanitized parameters, MySQL schema version, execution status, duration, row count, mapped result, final answer, feedback, and corrections to one trace. It MUST NOT log credentials, complete connection strings, hidden reasoning, or raw secret-bearing errors.

#### Scenario: Successful traced query
- **WHEN** an inventory query succeeds
- **THEN** all four gold-case layers—business intent, SQL template, execution result, and answer explanation—are reconstructable from append-only events

#### Scenario: Human correction
- **WHEN** a user corrects a product field, inventory interpretation, supplier attribution, shelf, or answer wording
- **THEN** the system appends a linked correction event without modifying the original trace

#### Scenario: Read accuracy gate
- **WHEN** the change is evaluated for release
- **THEN** the combined read gold cases achieve at least 95% at each reported layer and any failure blocks publication or archive
