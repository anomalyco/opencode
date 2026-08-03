# Standard Product Inventory Date and Remark Design

## Goal

Admit `商品信息8.3_结构化清洗.xlsx` as the latest authoritative standard, preserve its new `盘点日期` column and source `备注`, and continue emitting one robot `备注` value.

## Decision

The workbook contract becomes the exact 10-column sequence `原始行号`, `商品编码`, `商品名称`, `产地`, `数量`, `盘点日期`, `货架号`, `规格`, `型号`, `备注`. The importer trims but does not parse or reformat `盘点日期` or source `备注`. It stores both values separately and derives the existing display remark as follows:

- both present: `盘点日期；备注`
- only one present: that value
- both blank: `NULL`

The authoritative table receives additive nullable evidence columns so earlier runs remain readable. `Product.u_Remark` and `vw_standard_inventory_product.remark` use the derived value; the Feishu formatter and reply shape remain unchanged.

## Safety and validation

Preview remains write-free. Apply still requires exact workbook hash, row count, mapping counts, and active-run identity, backs up Product fields and shelves, never writes `Storage`, and rolls back on any mismatch. Validation covers 10,572 rows, both raw fields, the derived remark, Product equality, authoritative views, shelves, and the unchanged Storage fingerprint. The gateway restarts only after focused tests, full package checks, MySQL contract verification, Apply, and Validate succeed.
