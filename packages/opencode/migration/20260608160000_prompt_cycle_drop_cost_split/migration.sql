-- Drop the input/output cost split columns: they were never populated (the sync recorder
-- has no async model pricing) and the unused helper was removed. cost_total stays.
ALTER TABLE `prompt_cycle` DROP COLUMN `cost_input`;--> statement-breakpoint
ALTER TABLE `prompt_cycle` DROP COLUMN `cost_output`;
