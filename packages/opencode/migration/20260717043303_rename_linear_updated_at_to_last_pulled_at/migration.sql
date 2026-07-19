-- Rename `linear_updated_at` → `last_pulled_at` to align with `last_pushed_at`.
-- The rename is executed via the TS migration system
-- (packages/core/src/database/migration/20260717043303_rename_linear_updated_at_to_last_pulled_at.ts);
-- this SQL file is a documentation mirror and is not applied at runtime.
--
-- Idempotent: the base migration `20260621201623_add_issue_table` was amended
-- to create `last_pulled_at` directly, so fresh installs will NOT have a
-- `linear_updated_at` column to rename. Only existing installs that ran the
-- original base migration (with `linear_updated_at`) need this rename.
ALTER TABLE `issue` RENAME COLUMN `linear_updated_at` TO `last_pulled_at`;
