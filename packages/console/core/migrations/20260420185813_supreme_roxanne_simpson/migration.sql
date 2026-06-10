ALTER TABLE `model_tpm_limit` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `model_tpm_limit` ADD PRIMARY KEY (`id`);--> statement-breakpoint
ALTER TABLE `model_tpm_limit` DROP COLUMN `interval`;