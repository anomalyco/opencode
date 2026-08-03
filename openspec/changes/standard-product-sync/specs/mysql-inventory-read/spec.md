## MODIFIED Requirements

### Requirement: Schema preflight and drift protection
The system SHALL verify the target MySQL database identity and required schema before serving queries. The required data contract SHALL include the active authoritative product and shelf projections, their standard product identity, approved display fields, mapped legacy product identity when present, inventory quantity, supplier/origin, and source run identity. It SHALL require `Storage.Prod_ID` and `Storage.Prod_Number1` only as dependencies of the authoritative projection and MUST NOT require purchase-history or supplier-source fallback tables for supplier display.

#### Scenario: Required schema matches
- **WHEN** the configured database contains the authoritative views, required keys and compatible field types, one validated active run, and the required Storage fields
- **THEN** preflight records the MySQL schema version and active standard run identity and enables the query adapter

#### Scenario: Required schema drifts
- **WHEN** a required view, field, key, active run, compatible type, or validation state is missing or changed
- **THEN** the adapter fails closed without guessing a replacement field, querying legacy Product directly, or querying an old database

### Requirement: Product and inventory mapping
The system SHALL use the active standard product identity as its internal result identity, SHALL obtain approved name, attribute, normalized size, remark, supplier/origin, and shelves only from the authoritative projections, and SHALL use the projection's inventory quantity. `Product.u_Code`, `Product.s_ID`, and the standard product identity MUST NOT be mapped into the answer domain.

#### Scenario: Product has live inventory and shelves
- **WHEN** a matching authoritative product maps to a Product row with Storage and one or more approved shelf relations
- **THEN** the result contains approved business fields and ordered unique shelves with the live inventory quantity and no internal identifier

#### Scenario: Approved product has no legacy mapping
- **WHEN** a matching authoritative product is `MISSING` or `AMBIGUOUS`
- **THEN** the result still contains its approved business fields and shelves with workbook quantity and no fabricated legacy identity

#### Scenario: Approved product has no shelf
- **WHEN** the active authoritative row has no shelf relation
- **THEN** the result omits shelves and MUST NOT parse a shelf from Product text or remarks

#### Scenario: Duplicate visible names have distinct standard identities
- **WHEN** multiple active authoritative rows share the same visible name
- **THEN** the system preserves each result in deterministic standard source-row order without exposing or using a visible code as answer identity

### Requirement: Supplier display and source precedence
The system SHALL use only the active authoritative product's `origin` value, sourced from workbook `产地`, as the supplier display. It MUST NOT query or infer a supplier from structured stock-source overlays, purchase history, product names, remarks, free text, fixed examples, or unmatched identifiers. A blank approved origin SHALL omit supplier display.

#### Scenario: Approved supplier exists
- **WHEN** the active authoritative row has a non-empty origin
- **THEN** the system emits exactly that origin as the supplier immediately before inventory

#### Scenario: Approved supplier is blank
- **WHEN** the active authoritative row has an empty origin
- **THEN** the system omits supplier display and retains the inventory quantity

#### Scenario: Purchase history disagrees
- **WHEN** migrated purchase history names a different or more recent supplier
- **THEN** purchase history is not queried for presentation and cannot change the approved supplier
